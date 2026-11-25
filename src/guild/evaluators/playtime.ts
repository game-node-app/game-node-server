import { GUILD_MIN_PLAYTIME_SECONDS_PER_DAY } from "../guild.constants";
import type { GuildEvaluationContext, GuildEvaluatorFn } from "./types";
import { emptyEvaluation, windowEnd } from "./types";
import {
    filterGameIdsByCriteria,
    filterGameIdsByTimeToBeat,
} from "./game-criteria";

const statusOptions = (contract: GuildEvaluationContext["contract"]) =>
    contract.criteria.status ? [contract.criteria.status] : undefined;

/** Instant just before `acceptedAt`, so an observation exactly then counts. */
const playtimeStart = (acceptedAt: Date) => new Date(acceptedAt.getTime() - 1);

/**
 * `log_playtime`: total minutes or distinct games over a per-game delta floor.
 * Initial lifetime imports never count (spec: contracts).
 */
export const evaluateLogPlaytime: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
    playtimeHistory,
    timeToBeat,
}) => {
    const rows = await playtimeHistory.getTotalPlaytimeForPeriod(
        {
            userId: contract.profileUserId,
            startDate: playtimeStart(contract.acceptedAt),
            endDate: windowEnd(contract, now),
        },
        { excludeInitialObservations: true },
    );

    const secondsByGame = new Map<number, number>();
    for (const row of rows) {
        const gameId = Number(row.gameId);
        secondsByGame.set(
            gameId,
            (secondsByGame.get(gameId) ?? 0) +
                Number(row.totalPlaytimeInPeriodSeconds),
        );
    }

    let gameIds = [...secondsByGame.keys()];
    if (contract.targetGameId !== null) {
        gameIds = gameIds.filter(
            (gameId) => gameId === Number(contract.targetGameId),
        );
    }
    gameIds = await filterGameIdsByCriteria(query, gameIds, contract.criteria, {
        userId: contract.profileUserId,
        libraryStatuses: statusOptions(contract),
    });
    gameIds = await filterGameIdsByTimeToBeat(
        gameIds,
        contract.criteria,
        now,
        timeToBeat,
    );

    const minimumPerGame = contract.criteria.minPlaytimeSecondsPerGame;
    if (minimumPerGame != null) {
        const qualifying = gameIds.filter(
            (gameId) => (secondsByGame.get(gameId) ?? 0) >= minimumPerGame,
        );
        return {
            progress: qualifying.length,
            gameIds: qualifying,
            sourceKeys: qualifying.map((gameId) => `game:${gameId}`),
            completedAt: null,
        };
    }

    const totalSeconds = gameIds.reduce(
        (sum, gameId) => sum + (secondsByGame.get(gameId) ?? 0),
        0,
    );
    return {
        progress: Math.floor(totalSeconds / 60),
        gameIds,
        sourceKeys: gameIds.map((gameId) => `game:${gameId}`),
        completedAt: null,
    };
};

/** `play_distinct_days`: São Paulo days with at least 15 minutes of play. */
export const evaluatePlayDistinctDays: GuildEvaluatorFn = async ({
    query,
    contract,
    now,
    playtimeHistory,
    timeToBeat,
}) => {
    const rows = await playtimeHistory.getDailyPlaytimeForPeriod(
        contract.profileUserId,
        playtimeStart(contract.acceptedAt),
        windowEnd(contract, now),
        { excludeInitialObservations: true, saoPauloDays: true },
    );

    const secondsByGame = new Map<number, number>();
    for (const row of rows) {
        const gameId = Number(row.gameId);
        secondsByGame.set(
            gameId,
            (secondsByGame.get(gameId) ?? 0) + Number(row.seconds),
        );
    }

    let gameIds = [...secondsByGame.keys()];
    if (contract.targetGameId !== null) {
        gameIds = gameIds.filter(
            (gameId) => gameId === Number(contract.targetGameId),
        );
    }
    gameIds = await filterGameIdsByCriteria(query, gameIds, contract.criteria, {
        userId: contract.profileUserId,
        libraryStatuses: statusOptions(contract),
    });
    gameIds = await filterGameIdsByTimeToBeat(
        gameIds,
        contract.criteria,
        now,
        timeToBeat,
    );
    const qualifyingGames = new Set(gameIds);
    if (qualifyingGames.size === 0) return emptyEvaluation();

    const secondsByDay = new Map<string, number>();
    for (const row of rows) {
        if (!qualifyingGames.has(Number(row.gameId))) continue;
        secondsByDay.set(
            row.day,
            (secondsByDay.get(row.day) ?? 0) + Number(row.seconds),
        );
    }
    const days = [...secondsByDay.entries()]
        .filter(([, seconds]) => seconds >= GUILD_MIN_PLAYTIME_SECONDS_PER_DAY)
        .map(([day]) => day)
        .sort();

    return {
        progress: days.length,
        gameIds,
        sourceKeys: days.map((day) => `day:${day}`),
        completedAt: null,
    };
};
