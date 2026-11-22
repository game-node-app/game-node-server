import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { dailyToday } from "../daily/daily.constants";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { GuildContract } from "./entities/guild-contract.entity";
import {
    GUILD_MIN_REVIEW_CHARS,
    GuildContractStatus,
    GuildCriteria,
    GuildObjectiveType,
} from "./guild.constants";
import {
    GuildTimeToBeatService,
    getEffectiveTtbSeconds,
} from "./guild-time-to-beat.service";

/** First instant of the month containing `now` and of the next month, in São Paulo. */
function currentMonthBounds(now: Date): { start: Date; end: Date } {
    const [year, month] = dailyToday(now).split("-").map(Number);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return {
        start: new Date(
            `${year}-${String(month).padStart(2, "0")}-01T00:00:00-03:00`,
        ),
        end: new Date(
            `${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00-03:00`,
        ),
    };
}

/**
 * Evaluates accepted contracts against facts committed after `acceptedAt`,
 * moving them to `ready_to_claim` exactly once (design 5).
 */
@Injectable()
export class GuildContractEvaluatorService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly guildTimeToBeatService: GuildTimeToBeatService,
    ) {}

    /** Lazily expires overdue `active` contracts; ready/completed rows never expire. */
    public async expireOverdueContracts(
        userId?: string,
        now = new Date(),
    ): Promise<number> {
        return this.expireOverdueWithManager(
            this.dataSource.manager,
            userId,
            now,
        );
    }

    public async expireOverdueWithManager(
        manager: EntityManager,
        userId: string | undefined,
        now: Date,
    ): Promise<number> {
        const conditions = [
            "status = ?",
            "expiresAt IS NOT NULL",
            "expiresAt <= ?",
        ];
        const parameters: unknown[] = [
            GuildContractStatus.EXPIRED,
            GuildContractStatus.ACTIVE,
            now,
        ];
        if (userId) {
            conditions.push("profileUserId = ?");
            parameters.push(userId);
        }

        const result = await manager.query(
            `UPDATE guild_contract SET status = ? WHERE ${conditions.join(" AND ")}`,
            parameters,
        );
        return Number(result.affectedRows ?? 0);
    }

    public async evaluateUserContracts(
        userId: string,
        now = new Date(),
    ): Promise<void> {
        // Fast indexed exit for users holding no active contract.
        const activeContracts = await this.dataSource
            .getRepository(GuildContract)
            .find({
                where: {
                    profileUserId: userId,
                    status: GuildContractStatus.ACTIVE,
                },
                relations: { targetGame: true },
            });
        if (activeContracts.length === 0) return;

        await this.expireOverdueWithManager(
            this.dataSource.manager,
            userId,
            now,
        );

        for (const contract of activeContracts) {
            if (contract.expiresAt !== null && contract.expiresAt <= now)
                continue;

            const computed =
                contract.objectiveType === GuildObjectiveType.FINISH_GAME
                    ? await this.countFinishedGames(contract, now)
                    : await this.countReviews(contract, now);

            if (computed >= contract.progressTarget) {
                await this.markReady(contract, now);
            } else if (computed !== contract.progressCurrent) {
                await this.dataSource.getRepository(GuildContract).update(
                    {
                        id: contract.id,
                        status: GuildContractStatus.ACTIVE,
                    },
                    { progressCurrent: computed },
                );
            }
        }
    }

    private async countFinishedGames(
        contract: GuildContract,
        now: Date,
    ): Promise<number> {
        const conditions = [
            "h.libraryUserId = ?",
            "h.toStatus = ?",
            "h.source = ?",
            "h.occurredAt >= ?",
            // The earliest finish is the game's first finish; a re-finish never counts.
            `NOT EXISTS (
                SELECT 1 FROM collection_entry_status_history earlier
                WHERE earlier.libraryUserId = h.libraryUserId
                  AND earlier.gameId = h.gameId
                  AND earlier.toStatus = h.toStatus
                  AND (earlier.occurredAt < h.occurredAt
                       OR (earlier.occurredAt = h.occurredAt AND earlier.id < h.id))
            )`,
        ];
        const parameters: unknown[] = [
            contract.profileUserId,
            CollectionEntryStatus.FINISHED,
            "manual",
            contract.acceptedAt,
        ];
        if (contract.expiresAt !== null) {
            conditions.push("h.occurredAt < ?");
            parameters.push(contract.expiresAt);
        }
        // A finish dated after the evaluation instant is not progress yet.
        conditions.push("h.occurredAt <= ?");
        parameters.push(now);
        if (contract.targetGameId !== null) {
            conditions.push("h.gameId = ?");
            parameters.push(contract.targetGameId);
        }
        this.applyGameCriteria(
            conditions,
            parameters,
            contract.criteria,
            "h.gameId",
        );

        const rows: Array<{ gameId: number }> = await this.dataSource.query(
            `SELECT DISTINCT h.gameId FROM collection_entry_status_history h
                 WHERE ${conditions.join(" AND ")}`,
            parameters,
        );
        return this.countWithinTimeToBeat(
            rows.map((row) => Number(row.gameId)),
            contract.criteria,
            now,
        );
    }

    private async countReviews(
        contract: GuildContract,
        now: Date,
    ): Promise<number> {
        const conditions = [
            "r.profileUserId = ?",
            "r.createdAt >= ?",
            "CHAR_LENGTH(TRIM(r.content)) >= ?",
        ];
        const parameters: unknown[] = [
            contract.profileUserId,
            contract.acceptedAt,
            GUILD_MIN_REVIEW_CHARS,
        ];
        if (contract.expiresAt !== null) {
            conditions.push("r.createdAt < ?");
            parameters.push(contract.expiresAt);
        }
        if (contract.targetGameId !== null) {
            conditions.push("r.gameId = ?");
            parameters.push(contract.targetGameId);
        }
        this.applyGameCriteria(
            conditions,
            parameters,
            contract.criteria,
            "r.gameId",
        );
        if (contract.criteria.finishedInCurrentMonth === true) {
            const { start, end } = currentMonthBounds(now);
            conditions.push(
                `EXISTS (SELECT 1 FROM collection_entry ce
                     WHERE ce.libraryUserId = r.profileUserId
                       AND ce.gameId = r.gameId
                       AND ce.status = ?
                       AND ce.finishedAt >= ? AND ce.finishedAt < ?)`,
            );
            parameters.push(CollectionEntryStatus.FINISHED, start, end);
        }

        // shortcut: deleting and rewriting a review for the same game can count
        // again in a later contract; upgrade with review history if abused.
        const rows: Array<{ gameId: number }> = await this.dataSource.query(
            `SELECT DISTINCT r.gameId FROM review r
             WHERE ${conditions.join(" AND ")}`,
            parameters,
        );
        return rows.length;
    }

    /** Game-set filters shared by finishes and reviews. */
    private applyGameCriteria(
        conditions: string[],
        parameters: unknown[],
        criteria: GuildCriteria,
        gameColumn = "ce.gameId",
    ): void {
        const inClause = (values: number[]) => values.map(() => "?").join(",");

        if (criteria.gameIds?.length) {
            conditions.push(`${gameColumn} IN (${inClause(criteria.gameIds)})`);
            parameters.push(...criteria.gameIds);
        }
        if (criteria.genreIds?.length) {
            conditions.push(
                `EXISTS (SELECT 1 FROM game_genres_game_genre gg
                     WHERE gg.gameId = ${gameColumn}
                       AND gg.gameGenreId IN (${inClause(criteria.genreIds)}))`,
            );
            parameters.push(...criteria.genreIds);
        }
        if (criteria.themeIds?.length) {
            conditions.push(
                `EXISTS (SELECT 1 FROM game_themes_game_theme gt
                     WHERE gt.gameId = ${gameColumn}
                       AND gt.gameThemeId IN (${inClause(criteria.themeIds)}))`,
            );
            parameters.push(...criteria.themeIds);
        }
        if (criteria.keywordIds?.length) {
            conditions.push(
                `EXISTS (SELECT 1 FROM game_keywords_game_keyword gk
                     WHERE gk.gameId = ${gameColumn}
                       AND gk.gameKeywordId IN (${inClause(criteria.keywordIds)}))`,
            );
            parameters.push(...criteria.keywordIds);
        }
    }

    /** Games with no cached time-to-beat never qualify a TTB-limited contract. */
    private async countWithinTimeToBeat(
        gameIds: number[],
        criteria: GuildCriteria,
        now: Date,
    ): Promise<number> {
        if (criteria.maxTimeToBeatHours == null) return gameIds.length;

        const cached = await this.guildTimeToBeatService.getForGameIds(
            gameIds,
            now,
        );
        const maxSeconds = criteria.maxTimeToBeatHours * 60 * 60;
        return gameIds.filter((gameId) => {
            const seconds = getEffectiveTtbSeconds(cached.get(gameId));
            return seconds !== null && seconds > 0 && seconds <= maxSeconds;
        }).length;
    }

    private async markReady(contract: GuildContract, now: Date): Promise<void> {
        await this.dataSource.transaction(async (manager) => {
            const rows: Array<{
                id: string;
                status: GuildContractStatus;
                expiresAt: Date | null;
            }> = await manager.query(
                "SELECT id, status, expiresAt FROM guild_contract WHERE id = ? FOR UPDATE",
                [contract.id],
            );
            const locked = rows[0];
            if (!locked || locked.status !== GuildContractStatus.ACTIVE) return;
            if (locked.expiresAt !== null && new Date(locked.expiresAt) <= now)
                return;

            const result = await manager.query(
                `UPDATE guild_contract
                 SET status = ?, progressCurrent = ?, readyAt = ?
                 WHERE id = ? AND status = ?`,
                [
                    GuildContractStatus.READY_TO_CLAIM,
                    contract.progressTarget,
                    now,
                    contract.id,
                    GuildContractStatus.ACTIVE,
                ],
            );
            if (Number(result.affectedRows) !== 1) return;

            // Same transaction: the intent exists iff this transition happened.
            await appendNotificationIntent(manager, {
                eventType: "guild.contract-ready",
                eventVersion: 1,
                occurredAt: now,
                recipientUserId: contract.profileUserId,
                actorUserId: null,
                payload: {
                    contractId: contract.id,
                    category: contract.category,
                    templateKey: contract.templateKey,
                    eventId: contract.eventId,
                    targetGameId: contract.targetGameId,
                },
            });
        });
    }
}
