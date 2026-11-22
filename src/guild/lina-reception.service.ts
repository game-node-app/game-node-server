import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import {
    GuildContractStatus,
    GuildEventStatus,
    GUILD_INACTIVITY_DAYS,
    currentWeekStart,
    DAY_MS,
    LinaPose,
    LinaTrigger,
    STALE_BACKLOG_DAYS,
    weekStartToUtcDate,
} from "./guild.constants";
import { LinaReceptionDto } from "./dto/guild-profile.dto";
import { GuildContract } from "./entities/guild-contract.entity";
import { GuildProfile } from "./entities/guild-profile.entity";
import { GuildProfileService } from "./guild-profile.service";

export interface StaleBacklogGame {
    gameId: number;
    gameName: string;
    sinceYear: number;
}

export interface EvaluateReceptionOptions {
    readyContract?: GuildContract | null;
    now?: Date;
    updateLastVisited?: boolean;
}

@Injectable()
export class LinaReceptionService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly guildProfileService: GuildProfileService,
    ) {}

    /**
     * True when the board was never seen, the Monday cycle rolled over, or an active
     * curated event was published after the last acknowledgement.
     */
    public async computeHasUnseenBoard(
        guildProfile: GuildProfile,
        now = new Date(),
        manager?: EntityManager,
    ): Promise<boolean> {
        const lastBoardSeenAt = guildProfile.lastBoardSeenAt;
        if (!lastBoardSeenAt) return true;
        if (lastBoardSeenAt < weekStartToUtcDate(currentWeekStart(now))) {
            return true;
        }

        const executor = manager ?? this.dataSource;
        const [row] = await executor.query(
            `SELECT MAX(publishedAt) AS publishedAt FROM guild_event
             WHERE status = ? AND startsAt <= ? AND endsAt > ?`,
            [GuildEventStatus.PUBLISHED, now, now],
        );
        const latestPublishedAt = row?.publishedAt
            ? new Date(row.publishedAt)
            : null;
        return (
            latestPublishedAt !== null && lastBoardSeenAt < latestPublishedAt
        );
    }

    /** Oldest planned/dropped game untouched for over a year, without recent playtime. */
    public async findOldestStaleBacklogGame(
        userId: string,
        now = new Date(),
    ): Promise<StaleBacklogGame | null> {
        const cutoff = new Date(now.getTime() - STALE_BACKLOG_DAYS * DAY_MS);
        const [row] = await this.dataSource.query(
            `SELECT ce.gameId, g.name AS gameName,
                    YEAR(COALESCE(ce.plannedAt, ce.createdAt)) AS sinceYear
             FROM collection_entry ce
             INNER JOIN game g ON g.id = ce.gameId
             WHERE ce.libraryUserId = ? AND ce.status IN (?, ?)
               AND COALESCE(ce.plannedAt, ce.createdAt) < ?
               AND NOT EXISTS (
                   SELECT 1 FROM user_playtime up
                   WHERE up.profileUserId = ce.libraryUserId
                     AND up.gameId = ce.gameId
                     AND up.lastPlayedDate >= ?
               )
               AND NOT EXISTS (
                   SELECT 1 FROM collection_entry_status_history h
                   WHERE h.libraryUserId = ce.libraryUserId
                     AND h.gameId = ce.gameId
                     AND h.toStatus = ?
               )
             ORDER BY COALESCE(ce.plannedAt, ce.createdAt) ASC, ce.gameId ASC
             LIMIT 1`,
            [
                userId,
                CollectionEntryStatus.PLANNED,
                CollectionEntryStatus.DROPPED,
                cutoff,
                cutoff,
                CollectionEntryStatus.FINISHED,
            ],
        );

        return row
            ? {
                  gameId: Number(row.gameId),
                  gameName: row.gameName,
                  sinceYear: Number(row.sinceYear),
              }
            : null;
    }

    public async evaluateReception(
        userId: string,
        guildProfile: GuildProfile,
        options: EvaluateReceptionOptions = {},
    ): Promise<LinaReceptionDto> {
        const now = options.now ?? new Date();
        const hasUnseenBoard = await this.computeHasUnseenBoard(
            guildProfile,
            now,
        );
        const readyContract =
            options.readyContract !== undefined
                ? options.readyContract
                : await this.dataSource.getRepository(GuildContract).findOne({
                      where: {
                          profileUserId: userId,
                          status: GuildContractStatus.READY_TO_CLAIM,
                      },
                      relations: { targetGame: true },
                      order: { readyAt: "ASC", createdAt: "ASC" },
                  });

        let reception: LinaReceptionDto;
        if (readyContract) {
            const targetGameName = await this.targetGameName(readyContract);
            reception = {
                trigger: LinaTrigger.CONTRACT_READY_TO_CLAIM,
                pose: LinaPose.HAPPY,
                context: {
                    contractId: readyContract.id,
                    category: readyContract.category,
                    templateKey: readyContract.templateKey,
                    eventId: readyContract.eventId,
                    targetGameId: readyContract.targetGameId,
                    ...(targetGameName ? { targetGameName } : {}),
                },
                hasUnseenBoard,
            };
        } else {
            const inactiveDays = await this.returningInactiveDays(
                guildProfile,
                now,
            );
            if (inactiveDays !== null) {
                reception = {
                    trigger: LinaTrigger.RETURNING_AFTER_INACTIVITY,
                    pose: LinaPose.NEUTRAL,
                    context: { inactiveDays },
                    hasUnseenBoard,
                };
            } else if (hasUnseenBoard) {
                reception = {
                    trigger: LinaTrigger.WEEKLY_BOARD_REFRESHED,
                    pose: LinaPose.NEUTRAL,
                    context: {},
                    hasUnseenBoard,
                };
            } else {
                const staleGame = await this.findOldestStaleBacklogGame(
                    userId,
                    now,
                );
                reception = staleGame
                    ? {
                          trigger: LinaTrigger.STALE_BACKLOG_GAME,
                          pose: LinaPose.NEUTRAL,
                          context: { ...staleGame },
                          hasUnseenBoard,
                      }
                    : {
                          trigger: LinaTrigger.DEFAULT,
                          pose: LinaPose.NEUTRAL,
                          context: {},
                          hasUnseenBoard,
                      };
            }
        }

        // A visit updates lastVisitedAt after the inactivity check, never lastBoardSeenAt.
        if (options.updateLastVisited !== false) {
            await this.guildProfileService.touchLastVisitedAt(userId, now);
        }

        return reception;
    }

    /** Days since the last Guild visit when no platform activity happened meanwhile. */
    private async returningInactiveDays(
        guildProfile: GuildProfile,
        now: Date,
    ): Promise<number | null> {
        const lastVisitedAt = guildProfile.lastVisitedAt;
        if (!lastVisitedAt) return null;
        const inactiveDays = Math.floor(
            (now.getTime() - lastVisitedAt.getTime()) / DAY_MS,
        );
        if (inactiveDays < GUILD_INACTIVITY_DAYS) return null;

        const cutoff = new Date(now.getTime() - GUILD_INACTIVITY_DAYS * DAY_MS);
        const [row] = await this.dataSource.query(
            `SELECT GREATEST(
                COALESCE((SELECT MAX(updatedAt) FROM collection_entry WHERE libraryUserId = ?), '1970-01-01'),
                COALESCE((SELECT MAX(createdAt) FROM review WHERE profileUserId = ?), '1970-01-01'),
                COALESCE((SELECT MAX(lastPlayedDate) FROM user_playtime WHERE profileUserId = ?), '1970-01-01')
             ) AS lastActivityAt`,
            [
                guildProfile.profileUserId,
                guildProfile.profileUserId,
                guildProfile.profileUserId,
            ],
        );
        const lastActivityAt = row?.lastActivityAt
            ? new Date(row.lastActivityAt)
            : null;
        if (lastActivityAt !== null && lastActivityAt >= cutoff) return null;

        return inactiveDays;
    }

    private async targetGameName(
        contract: GuildContract,
    ): Promise<string | null> {
        if (contract.targetGame?.name) return contract.targetGame.name;
        if (contract.targetGameId === null) return null;
        const [row] = await this.dataSource.query(
            "SELECT name FROM game WHERE id = ?",
            [contract.targetGameId],
        );
        return row?.name ?? null;
    }
}
