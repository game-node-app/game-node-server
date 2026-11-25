import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import { DAY_MS, GuildCriteria } from "../guild.constants";
import {
    GuildTimeToBeatService,
    getEffectiveTtbSeconds,
} from "../guild-time-to-beat.service";

/** `DataSource` and `EntityManager` both satisfy this. */
export type GuildQueryExecutor = {
    query(query: string, parameters?: any[]): Promise<any>;
};

/** IGDB's "Indie" genre id (`game_genre` 32). */
export const GUILD_INDIE_GENRE_ID = 32;

export interface GuildGameMatchOptions {
    now?: Date;
    timeToBeat?: Pick<GuildTimeToBeatService, "getForGameIds">;
    /** Required for library status/staleness checks. */
    userId?: string;
    /** Current `collection_entry.status` values the target must be in. */
    libraryStatuses?: readonly CollectionEntryStatus[];
    /** Backlog age in days; planned/dropped and untouched for that long. */
    staleDays?: number;
}

const placeholders = (values: readonly unknown[]) =>
    values.map(() => "?").join(",");

/**
 * SQL conditions for the game metadata filters of `GuildCriteria`, scoped to
 * `gameColumn` (e.g. `h.gameId` or `g.id`). Time-to-beat needs the async cache
 * and is applied by `filterGameIdsByTimeToBeat` instead.
 */
export function addGameCriteriaConditions(
    conditions: string[],
    parameters: unknown[],
    criteria: GuildCriteria,
    gameColumn = "ce.gameId",
): void {
    if (criteria.gameIds?.length) {
        conditions.push(`${gameColumn} IN (${placeholders(criteria.gameIds)})`);
        parameters.push(...criteria.gameIds);
    }

    const relations: Array<[string, string, readonly number[] | undefined]> = [
        ["game_genres_game_genre", "gameGenreId", criteria.genreIds],
        ["game_themes_game_theme", "gameThemeId", criteria.themeIds],
        ["game_keywords_game_keyword", "gameKeywordId", criteria.keywordIds],
        [
            "game_franchises_game_franchise",
            "gameFranchiseId",
            criteria.franchiseIds,
        ],
        ["game_platform_games_game", "gamePlatformId", criteria.platformIds],
    ];
    for (const [table, column, values] of relations) {
        if (!values?.length) continue;
        conditions.push(
            `EXISTS (SELECT 1 FROM ${table} criteriaJoin
                 WHERE criteriaJoin.gameId = ${gameColumn}
                   AND criteriaJoin.${column} IN (${placeholders(values)}))`,
        );
        parameters.push(...values);
    }

    if (criteria.gameCategories?.length) {
        conditions.push(
            `EXISTS (SELECT 1 FROM game criteriaGame
                 WHERE criteriaGame.id = ${gameColumn}
                   AND criteriaGame.category IN (${placeholders(criteria.gameCategories)}))`,
        );
        parameters.push(...criteria.gameCategories);
    }
    if (criteria.releaseYearMin != null) {
        conditions.push(
            `EXISTS (SELECT 1 FROM game criteriaGame
                 WHERE criteriaGame.id = ${gameColumn}
                   AND YEAR(criteriaGame.firstReleaseDate) >= ?)`,
        );
        parameters.push(criteria.releaseYearMin);
    }
    if (criteria.releaseYearMax != null) {
        conditions.push(
            `EXISTS (SELECT 1 FROM game criteriaGame
                 WHERE criteriaGame.id = ${gameColumn}
                   AND YEAR(criteriaGame.firstReleaseDate) <= ?)`,
        );
        parameters.push(criteria.releaseYearMax);
    }
    if (criteria.indieOnly === true) {
        conditions.push(
            `EXISTS (SELECT 1 FROM game_genres_game_genre criteriaIndie
                 WHERE criteriaIndie.gameId = ${gameColumn}
                   AND criteriaIndie.gameGenreId = ?)`,
        );
        parameters.push(GUILD_INDIE_GENRE_ID);
    }
}

async function filterGameIdsByLibrary(
    executor: GuildQueryExecutor,
    gameIds: number[],
    options: GuildGameMatchOptions,
): Promise<number[]> {
    if (
        (!options.libraryStatuses?.length && options.staleDays == null) ||
        !options.userId ||
        gameIds.length === 0
    ) {
        return gameIds;
    }

    const conditions = [`ce.libraryUserId = ?`];
    const parameters: unknown[] = [options.userId];
    if (options.libraryStatuses?.length) {
        conditions.push(
            `ce.status IN (${placeholders(options.libraryStatuses)})`,
        );
        parameters.push(...options.libraryStatuses);
    }
    if (options.staleDays != null) {
        const cutoff = new Date(
            (options.now ?? new Date()).getTime() - options.staleDays * DAY_MS,
        );
        conditions.push(`COALESCE(ce.plannedAt, ce.createdAt) <= ?`);
        conditions.push(
            `NOT EXISTS (SELECT 1 FROM user_playtime up
                 WHERE up.profileUserId = ce.libraryUserId
                   AND up.gameId = ce.gameId
                   AND up.lastPlayedDate >= ?)`,
        );
        parameters.push(cutoff, cutoff);
    }

    const rows: Array<{ gameId: number }> = await executor.query(
        `SELECT DISTINCT ce.gameId FROM collection_entry ce
         WHERE ce.gameId IN (${placeholders(gameIds)}) AND ${conditions.join(" AND ")}`,
        [...gameIds, ...parameters],
    );
    const allowed = new Set(rows.map((row) => Number(row.gameId)));
    return gameIds.filter((gameId) => allowed.has(gameId));
}

/** Keeps only games matching every `GuildCriteria` filter. */
export async function filterGameIdsByCriteria(
    executor: GuildQueryExecutor,
    gameIds: number[],
    criteria: GuildCriteria,
    options: GuildGameMatchOptions = {},
): Promise<number[]> {
    if (gameIds.length === 0) return [];

    const conditions = ["g.id IN (" + placeholders(gameIds) + ")"];
    const parameters: unknown[] = [...gameIds];
    addGameCriteriaConditions(conditions, parameters, criteria, "g.id");
    const rows: Array<{ id: number }> = await executor.query(
        `SELECT g.id FROM game g WHERE ${conditions.join(" AND ")}`,
        parameters,
    );
    const matching = new Set(rows.map((row) => Number(row.id)));
    const typed = gameIds.filter((gameId) => matching.has(gameId));
    return filterGameIdsByLibrary(executor, typed, options);
}

/** Games without a cached TTB never satisfy a TTB-limited quest. */
export async function filterGameIdsByTimeToBeat(
    gameIds: number[],
    criteria: GuildCriteria,
    now: Date,
    timeToBeat?: Pick<GuildTimeToBeatService, "getForGameIds">,
): Promise<number[]> {
    if (
        criteria.minTimeToBeatHours == null &&
        criteria.maxTimeToBeatHours == null
    ) {
        return gameIds;
    }
    if (!timeToBeat || gameIds.length === 0) return [];

    const cached = await timeToBeat.getForGameIds(gameIds, now);
    const minSeconds =
        criteria.minTimeToBeatHours == null
            ? null
            : criteria.minTimeToBeatHours * 60 * 60;
    const maxSeconds =
        criteria.maxTimeToBeatHours == null
            ? null
            : criteria.maxTimeToBeatHours * 60 * 60;
    return gameIds.filter((gameId) => {
        const seconds = getEffectiveTtbSeconds(cached.get(gameId));
        if (seconds === null || seconds <= 0) return false;
        if (minSeconds !== null && seconds < minSeconds) return false;
        if (maxSeconds !== null && seconds > maxSeconds) return false;
        return true;
    });
}

/**
 * Accept-time `targetGameId` validation against extended criteria, library
 * status and stale-backlog requirements (shared with `GuildContractsService`).
 */
export async function gameMatchesGuildCriteria(
    executor: GuildQueryExecutor,
    gameId: number,
    criteria: GuildCriteria,
    options: GuildGameMatchOptions = {},
): Promise<boolean> {
    const conditions = ["g.id = ?"];
    const parameters: unknown[] = [gameId];
    addGameCriteriaConditions(conditions, parameters, criteria, "g.id");

    const rows = await executor.query(
        `SELECT 1 AS ok FROM game g WHERE ${conditions.join(" AND ")}`,
        parameters,
    );
    if (rows.length === 0) return false;

    const byTimeToBeat = await filterGameIdsByTimeToBeat(
        [gameId],
        criteria,
        options.now ?? new Date(),
        options.timeToBeat,
    );
    if (byTimeToBeat.length === 0) return false;

    const byLibrary = await filterGameIdsByLibrary(executor, [gameId], options);
    return byLibrary.length === 1;
}
