import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import { dailyToday } from "../../daily/daily.constants";
import { GUILD_MIN_REVIEW_CHARS, GuildCriteria } from "../guild.constants";
import type { GuildEvaluatorFn } from "./types";
import { addWindowConditions } from "./types";
import {
    addGameCriteriaConditions,
    filterGameIdsByTimeToBeat,
} from "./game-criteria";

/** First instant of the month containing `now` and of the next month, in São Paulo. */
export function currentMonthBounds(now: Date): { start: Date; end: Date } {
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

/** Distinct reviewed games with a per-quest character floor (design 3). */
export const evaluateWriteReview: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
    timeToBeat,
}) => {
    const criteria: GuildCriteria = contract.criteria;
    const conditions = [
        "r.profileUserId = ?",
        "CHAR_LENGTH(TRIM(r.content)) >= ?",
    ];
    const parameters: unknown[] = [
        contract.profileUserId,
        criteria.minReviewChars ?? GUILD_MIN_REVIEW_CHARS,
    ];
    addWindowConditions(conditions, parameters, "r.createdAt", contract, now);
    if (contract.targetGameId !== null) {
        conditions.push("r.gameId = ?");
        parameters.push(contract.targetGameId);
    }
    addGameCriteriaConditions(conditions, parameters, criteria, "r.gameId");
    if (criteria.finishedInCurrentMonth === true) {
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
    const rows: Array<{ gameId: number; lastCreatedAt: Date }> =
        await query.query(
            `SELECT r.gameId AS gameId, MAX(r.createdAt) AS lastCreatedAt
             FROM review r
             WHERE ${conditions.join(" AND ")}
             GROUP BY r.gameId`,
            parameters,
        );
    const reviewedByGame = new Map(
        rows.map((row) => [Number(row.gameId), new Date(row.lastCreatedAt)]),
    );
    const gameIds = await filterGameIdsByTimeToBeat(
        [...reviewedByGame.keys()],
        criteria,
        now,
        timeToBeat,
    );
    const completedAt = gameIds.reduce<Date | null>((latest, gameId) => {
        const createdAt = reviewedByGame.get(gameId)!;
        return latest === null || createdAt > latest ? createdAt : latest;
    }, null);

    return {
        progress: gameIds.length,
        gameIds,
        sourceKeys: gameIds.map((gameId) => `review:${gameId}`),
        completedAt,
    };
};
