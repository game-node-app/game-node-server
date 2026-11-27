import type { GuildContract } from "../entities/guild-contract.entity";
import {
    DAY_MS,
    GUILD_BONUS_REVIEW_MIN_CHARS,
    GUILD_BONUS_STALE_DAYS,
} from "../guild.constants";
import type { GuildQueryExecutor } from "./game-criteria";
import type { GuildObjectiveEvaluation } from "./types";

export interface GuildBonusObjectiveInput {
    query: GuildQueryExecutor;
    contract: Pick<
        GuildContract,
        | "profileUserId"
        | "acceptedAt"
        | "expiresAt"
        | "targetGameId"
        | "bonusObjective"
    >;
    /** Facts the base objective credited; the claim re-check may pass only ids. */
    evaluation: Pick<GuildObjectiveEvaluation, "gameIds" | "completedAt">;
    now: Date;
}

const bonusGameIds = (input: GuildBonusObjectiveInput): number[] =>
    input.contract.targetGameId !== null
        ? [Number(input.contract.targetGameId)]
        : [...new Set(input.evaluation.gameIds)];

/**
 * Optional secondary objective. A false result never blocks the base claim
 * (spec: contracts); `null`/missing bonus returns false.
 */
export async function evaluateGuildBonusObjective(
    input: GuildBonusObjectiveInput,
): Promise<boolean> {
    const bonus = input.contract.bonusObjective;
    if (!bonus) return false;

    switch (bonus.type) {
        case "finish_before_half_deadline": {
            const { expiresAt, acceptedAt } = input.contract;
            if (expiresAt === null) return false;
            const finishedAt = input.evaluation.completedAt ?? input.now;
            const halfDeadline =
                acceptedAt.getTime() +
                (expiresAt.getTime() - acceptedAt.getTime()) / 2;
            return finishedAt.getTime() <= halfDeadline;
        }
        case "also_write_review": {
            const gameIds = bonusGameIds(input);
            if (gameIds.length === 0) return false;
            const rows = await input.query.query(
                `SELECT 1 AS ok FROM review r
                 WHERE r.profileUserId = ?
                   AND r.gameId IN (${gameIds.map(() => "?").join(",")})
                   AND r.createdAt >= ?
                   AND CHAR_LENGTH(TRIM(r.content)) >= ?
                 LIMIT 1`,
                [
                    input.contract.profileUserId,
                    ...gameIds,
                    input.contract.acceptedAt,
                    bonus.minChars ?? GUILD_BONUS_REVIEW_MIN_CHARS,
                ],
            );
            return rows.length > 0;
        }
        case "use_stale_backlog_game": {
            const gameIds = bonusGameIds(input);
            if (gameIds.length === 0) return false;
            const cutoff = new Date(
                input.contract.acceptedAt.getTime() -
                    (bonus.staleDays ?? GUILD_BONUS_STALE_DAYS) * DAY_MS,
            );
            const rows = await input.query.query(
                `SELECT ce.gameId AS gameId FROM collection_entry ce
                 WHERE ce.libraryUserId = ?
                   AND ce.gameId IN (${gameIds.map(() => "?").join(",")})
                   AND COALESCE(ce.plannedAt, ce.createdAt) <= ?
                   AND NOT EXISTS (
                       SELECT 1 FROM user_playtime up
                       WHERE up.profileUserId = ce.libraryUserId
                         AND up.gameId = ce.gameId
                         AND up.lastPlayedDate >= ?
                         AND up.lastPlayedDate < ?
                   )`,
                [
                    input.contract.profileUserId,
                    ...gameIds,
                    cutoff,
                    cutoff,
                    input.contract.acceptedAt,
                ],
            );
            return rows.length > 0;
        }
        default:
            return false;
    }
}
