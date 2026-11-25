import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import type { GuildEvaluatorFn } from "./types";
import { addWindowConditions } from "./types";
import {
    addGameCriteriaConditions,
    filterGameIdsByTimeToBeat,
} from "./game-criteria";

/** Distinct manually finished games, first finish only (design 3). */
export const evaluateFinishGame: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
    timeToBeat,
}) => {
    const conditions = [
        "h.libraryUserId = ?",
        "h.toStatus = ?",
        "h.source = ?",
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
    ];
    addWindowConditions(conditions, parameters, "h.occurredAt", contract, now);
    if (contract.targetGameId !== null) {
        conditions.push("h.gameId = ?");
        parameters.push(contract.targetGameId);
    }
    addGameCriteriaConditions(
        conditions,
        parameters,
        contract.criteria,
        "h.gameId",
    );

    const rows: Array<{ gameId: number; lastOccurredAt: Date }> =
        await query.query(
            `SELECT h.gameId AS gameId, MAX(h.occurredAt) AS lastOccurredAt
             FROM collection_entry_status_history h
             WHERE ${conditions.join(" AND ")}
             GROUP BY h.gameId`,
            parameters,
        );
    const completedByGame = new Map(
        rows.map((row) => [Number(row.gameId), new Date(row.lastOccurredAt)]),
    );
    const gameIds = await filterGameIdsByTimeToBeat(
        [...completedByGame.keys()],
        contract.criteria,
        now,
        timeToBeat,
    );
    const completedAt = gameIds.reduce<Date | null>((latest, gameId) => {
        const occurredAt = completedByGame.get(gameId)!;
        return latest === null || occurredAt > latest ? occurredAt : latest;
    }, null);

    return {
        progress: gameIds.length,
        gameIds,
        sourceKeys: gameIds.map((gameId) => `game:${gameId}`),
        completedAt,
    };
};
