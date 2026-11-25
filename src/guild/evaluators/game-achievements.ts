import type { GuildEvaluatorFn } from "./types";
import { addWindowConditions } from "./types";
import {
    addGameCriteriaConditions,
    filterGameIdsByTimeToBeat,
} from "./game-criteria";

/** A 100% completion needs a meaningful achievement list. */
export const GUILD_MIN_AVAILABLE_ACHIEVEMENTS = 5;

/**
 * Synced achievements whose `obtainedAt` AND `createdAt` are in the window:
 * a historical backfill import can never fulfil a contract.
 */
export const evaluateEarnGameAchievements: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
    timeToBeat,
}) => {
    const conditions = ["oga.profileUserId = ?"];
    const parameters: unknown[] = [contract.profileUserId];
    addWindowConditions(
        conditions,
        parameters,
        "oga.obtainedAt",
        contract,
        now,
    );
    addWindowConditions(conditions, parameters, "oga.createdAt", contract, now);
    if (contract.targetGameId !== null) {
        conditions.push("geg.gameId = ?");
        parameters.push(contract.targetGameId);
    }
    addGameCriteriaConditions(
        conditions,
        parameters,
        contract.criteria,
        "geg.gameId",
    );

    const rows: Array<{
        achievementId: number;
        gameId: number;
        obtainedAt: Date;
    }> = await query.query(
        `SELECT oga.id AS achievementId, geg.gameId AS gameId,
                oga.obtainedAt AS obtainedAt
         FROM obtained_game_achievement oga
         INNER JOIN game_external_game geg ON geg.id = oga.externalGameId
         WHERE ${conditions.join(" AND ")}`,
        parameters,
    );

    const gameIds = [...new Set(rows.map((row) => Number(row.gameId)))];
    const qualifyingGames = new Set(
        await filterGameIdsByTimeToBeat(
            gameIds,
            contract.criteria,
            now,
            timeToBeat,
        ),
    );
    const qualifying = rows.filter((row) =>
        qualifyingGames.has(Number(row.gameId)),
    );
    const completedAt = qualifying.reduce<Date | null>((latest, row) => {
        const obtainedAt = new Date(row.obtainedAt);
        return latest === null || obtainedAt > latest ? obtainedAt : latest;
    }, null);

    return {
        progress: qualifying.length,
        gameIds: [...qualifyingGames],
        sourceKeys: qualifying.map((row) => `achievement:${row.achievementId}`),
        completedAt,
    };
};

/** Completed 100%/platinum games with at least 5 available achievements. */
export const evaluateCompleteGame100: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
    timeToBeat,
}) => {
    const conditions = [
        "gcs.profileUserId = ?",
        "(gcs.isCompleted = 1 OR gcs.isPlatinumObtained = 1)",
        "gcs.completedAt IS NOT NULL",
        "gcs.totalAvailableAchievements >= ?",
    ];
    const parameters: unknown[] = [
        contract.profileUserId,
        GUILD_MIN_AVAILABLE_ACHIEVEMENTS,
    ];
    addWindowConditions(
        conditions,
        parameters,
        "gcs.completedAt",
        contract,
        now,
    );
    if (contract.targetGameId !== null) {
        conditions.push("geg.gameId = ?");
        parameters.push(contract.targetGameId);
    }
    addGameCriteriaConditions(
        conditions,
        parameters,
        contract.criteria,
        "geg.gameId",
    );

    const rows: Array<{ gameId: number; completedAt: Date }> =
        await query.query(
            `SELECT geg.gameId AS gameId, MAX(gcs.completedAt) AS completedAt
             FROM game_completion_status gcs
             INNER JOIN game_external_game geg ON geg.id = gcs.externalGameId
             WHERE ${conditions.join(" AND ")}
             GROUP BY geg.gameId`,
            parameters,
        );
    const completedByGame = new Map(
        rows.map((row) => [Number(row.gameId), new Date(row.completedAt)]),
    );
    const gameIds = await filterGameIdsByTimeToBeat(
        [...completedByGame.keys()],
        contract.criteria,
        now,
        timeToBeat,
    );
    const completedAt = gameIds.reduce<Date | null>((latest, gameId) => {
        const completed = completedByGame.get(gameId)!;
        return latest === null || completed > latest ? completed : latest;
    }, null);

    return {
        progress: gameIds.length,
        gameIds,
        sourceKeys: gameIds.map((gameId) => `game:${gameId}`),
        completedAt,
    };
};
