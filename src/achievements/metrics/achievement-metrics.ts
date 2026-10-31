import { plainToInstance } from "class-transformer";
import {
    ArrayMaxSize,
    IsArray,
    IsInt,
    IsOptional,
    Max,
    Min,
    validateSync,
} from "class-validator";
import { EntityManager } from "typeorm";

export interface AchievementWindow {
    startsAt: Date;
    endsAt: Date;
}

export class GameFilterCriteria {
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    @Min(1, { each: true })
    gameIds?: number[];
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    @Min(1, { each: true })
    themeIds?: number[];
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(50)
    @IsInt({ each: true })
    @Min(1, { each: true })
    genreIds?: number[];
}

export class EmptyCriteria {}

export class AwardsCriteria {
    @IsInt()
    @Min(2000)
    @Max(3000)
    year: number;
}

export interface AchievementMetric {
    key: string;
    description: string;
    criteria: new () => object;
    /**
     * Criteria fields accepted by this metric.
     */
    filters: string[];
    supportsWindow: boolean;
    compute(
        manager: EntityManager,
        userId: string,
        criteria: any,
        window: AchievementWindow | null,
    ): Promise<number>;
    /**
     * Users with at least one relevant fact, ordered by id, after `afterUserId`.
     */
    candidates(
        manager: EntityManager,
        criteria: any,
        window: AchievementWindow | null,
        afterUserId: string | null,
        limit: number,
    ): Promise<string[]>;
}

interface CountQuery {
    /** FROM clause; must expose the user, game and date columns below */
    from: string;
    user: string;
    value: string;
    game?: string;
    date?: string;
    where?: (criteria: any) => [string, unknown[]];
}

function conditions(
    query: CountQuery,
    criteria: GameFilterCriteria,
    window: AchievementWindow | null,
): [string, unknown[]] {
    const [extra, params] = query.where?.(criteria) ?? ["", []];
    let sql = extra;
    if (query.game && criteria.gameIds?.length) {
        sql += ` AND ${query.game} IN (?)`;
        params.push(criteria.gameIds);
    }
    if (query.game && criteria.themeIds?.length) {
        sql += ` AND EXISTS (SELECT 1 FROM game_themes_game_theme gt WHERE gt.gameId = ${query.game} AND gt.gameThemeId IN (?))`;
        params.push(criteria.themeIds);
    }
    if (query.game && criteria.genreIds?.length) {
        sql += ` AND EXISTS (SELECT 1 FROM game_genres_game_genre gg WHERE gg.gameId = ${query.game} AND gg.gameGenreId IN (?))`;
        params.push(criteria.genreIds);
    }
    if (query.date && window) {
        sql += ` AND ${query.date} >= ? AND ${query.date} < ?`;
        params.push(window.startsAt, window.endsAt);
    }
    return [sql, params];
}

function countMetric(
    metric: Omit<
        AchievementMetric,
        "compute" | "candidates" | "supportsWindow"
    >,
    query: CountQuery,
): AchievementMetric {
    return {
        ...metric,
        supportsWindow: query.date != undefined,
        async compute(manager, userId, criteria, window) {
            const [sql, params] = conditions(query, criteria, window);
            const rows = await manager.query(
                `SELECT ${query.value} AS value FROM ${query.from} WHERE ${query.user} = ?${sql}`,
                [userId, ...params],
            );
            return Number(rows[0]?.value ?? 0);
        },
        async candidates(manager, criteria, window, afterUserId, limit) {
            const [sql, params] = conditions(query, criteria, window);
            const rows = await manager.query(
                `SELECT DISTINCT ${query.user} AS userId FROM ${query.from} WHERE ${query.user} > ?${sql} ORDER BY userId LIMIT ?`,
                [afterUserId ?? "", ...params, limit],
            );
            return rows.map((row: { userId: string }) => row.userId);
        },
    };
}

const GAME_FILTERS = ["gameIds", "themeIds", "genreIds"];

const metrics: AchievementMetric[] = [
    countMetric(
        {
            key: "reviews_written",
            description: "Reviews written by the user.",
            criteria: GameFilterCriteria,
            filters: GAME_FILTERS,
        },
        {
            from: "review r",
            user: "r.profileUserId",
            value: "COUNT(*)",
            game: "r.gameId",
            date: "r.createdAt",
        },
    ),
    countMetric(
        {
            key: "library_games",
            description:
                "Distinct games in the user's library. With a time window it also counts imported games, so events should prefer games_finished or reviews_written.",
            criteria: GameFilterCriteria,
            filters: GAME_FILTERS,
        },
        {
            from: "collection_entry ce",
            user: "ce.libraryUserId",
            value: "COUNT(DISTINCT ce.gameId)",
            game: "ce.gameId",
            date: "ce.createdAt",
        },
    ),
    countMetric(
        {
            key: "games_finished",
            description: "Library entries marked as finished.",
            criteria: GameFilterCriteria,
            filters: GAME_FILTERS,
        },
        {
            from: "collection_entry ce",
            user: "ce.libraryUserId",
            value: "COUNT(*)",
            game: "ce.gameId",
            date: "ce.finishedAt",
            where: () => [" AND ce.finishedAt IS NOT NULL", []],
        },
    ),
    countMetric(
        {
            key: "followers",
            description: "Followers of the user.",
            criteria: EmptyCriteria,
            filters: [],
        },
        {
            from: "user_follow uf",
            user: "uf.followedUserId",
            value: "COUNT(*)",
            date: "uf.createdAt",
        },
    ),
    countMetric(
        {
            key: "comments_written",
            description:
                "Comments written by the user on reviews, posts and activities.",
            criteria: EmptyCriteria,
            filters: [],
        },
        {
            from: `(SELECT profileUserId, createdAt FROM review_comment
                UNION ALL SELECT profileUserId, createdAt FROM post_comment
                UNION ALL SELECT profileUserId, createdAt FROM activity_comment) c`,
            user: "c.profileUserId",
            value: "COUNT(*)",
            date: "c.createdAt",
        },
    ),
    countMetric(
        {
            key: "awards_participation",
            description:
                "1 if the user voted in the GameNode Awards of the given year.",
            criteria: AwardsCriteria,
            filters: ["year"],
        },
        {
            from: `awards_vote v JOIN awards_category ac ON ac.id = v.categoryId
                JOIN awards_event ae ON ae.id = ac.eventId`,
            user: "v.profileUserId",
            value: "LEAST(COUNT(*), 1)",
            where: (criteria: AwardsCriteria) => [
                " AND ae.year = ? AND v.deletedAt IS NULL",
                [criteria.year],
            ],
        },
    ),
    {
        key: "manual",
        description:
            "Never evaluated. Obtained only through manual grants and codes.",
        criteria: EmptyCriteria,
        filters: [],
        supportsWindow: false,
        compute: async () => 0,
        candidates: async () => [],
    },
];

export const ACHIEVEMENT_METRICS = new Map(
    metrics.map((metric) => [metric.key, metric]),
);

/**
 * Validates criteria against the metric's accepted filters.
 * Returns the error messages, empty when valid.
 */
export function validateMetricCriteria(
    metric: AchievementMetric,
    criteria: unknown,
): string[] {
    if (
        criteria == null ||
        typeof criteria !== "object" ||
        Array.isArray(criteria)
    ) {
        return ["criteria must be an object"];
    }
    const unsupported = Object.keys(criteria).filter(
        (key) => !metric.filters.includes(key),
    );
    if (unsupported.length > 0) {
        return unsupported.map(
            (key) => `filter ${key} is not supported by metric ${metric.key}`,
        );
    }
    const errors = validateSync(plainToInstance(metric.criteria, criteria), {
        forbidUnknownValues: false,
    });
    return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}
