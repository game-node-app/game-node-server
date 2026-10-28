import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { createHash } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { GameRankingCriteriaDto, StatisticsRankingsRequestDto } from "./dto/statistics-api.dto";
import { MATURE_THEME_ID } from "../game/game-filter/game-filter.constants";
import { StatisticsSourceType } from "./statistics.constants";
import {
    floorStatisticsMicros,
    parseStatisticsInstant,
    statisticsInstantAtMicros,
    statisticsInstantFromDate,
    statisticsMicrosPerHour,
    StatisticsInstant,
} from "./statistics-time";

const definitionVersion = "engagement-v1";
const dayMs = 24 * 60 * 60 * 1000;
const periodDays: Record<string, number> = {
    day: 1,
    week: 7,
    month: 30,
    quarter: 90,
    half_year: 180,
    year: 365,
};
const preparedPeriods = ["day", "week", "month", "quarter", "half_year", "year", "all"];

type SourceQuery = { from: string; where: string; parameters: unknown[]; id: string; alias: string };
type ScoreQuery = { sql: string; parameters: unknown[] };

function safeCount(value: unknown): number {
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error("Ranking count is outside the safe numeric range");
    return count;
}

@Injectable()
export class StatisticsRankingService {
    constructor(
        private readonly dataSource: DataSource,
        @Optional() @Inject(CACHE_MANAGER) private readonly cache?: Cache,
    ) {}

    async refreshCommonScores(): Promise<void> {
        const gameKeys: Array<{ sourceType: StatisticsSourceType.GAME; mode: string; period: string }> = [
            ...preparedPeriods.map((period) => ({ sourceType: StatisticsSourceType.GAME as const, mode: "popular", period })),
            { sourceType: StatisticsSourceType.GAME, mode: "recent", period: "week" },
        ];
        const reviewKeys: Array<{ sourceType: StatisticsSourceType.REVIEW; mode: string; period: string }> = [
            ...preparedPeriods.map((period) => ({ sourceType: StatisticsSourceType.REVIEW as const, mode: "popular", period })),
            { sourceType: StatisticsSourceType.REVIEW, mode: "recent", period: "week" },
        ];
        for (let i = 0; i < gameKeys.length; i += 4) {
            const batch = gameKeys.slice(i, i + 4);
            await Promise.all(batch.map((k) => this.refreshKey(k.sourceType, k.mode, k.period)));
        }
        await Promise.all(reviewKeys.map((k) => this.refreshKey(k.sourceType, k.mode, k.period)));
    }

    private async refreshKey(
        sourceType: StatisticsSourceType.GAME | StatisticsSourceType.REVIEW,
        mode: string,
        period: string,
    ): Promise<void> {
        const asOf = new Date();
        const from = period === "all" ? null : new Date(asOf.getTime() - (periodDays[period] ?? 7) * dayMs);
        const score = this.scoreQuery(mode, from, asOf, period === "all");
        const key = `${sourceType}:${mode}:${period}`;
        const source = this.sourceQuery(sourceType);
        let attempts = 0;
        while (attempts < 3) {
            try {
                await this.dataSource.transaction(async (tx) => {
                    await tx.query(
                        `INSERT INTO ranking_score (rankingKey, targetId, score, definitionVersion, computedAt)
                        SELECT ?, t.id, COALESCE(score.score, 0), ?, ?
                        ${source.from}
                        LEFT JOIN (${score.sql}) score ON score.targetId = t.id
                        WHERE ${source.where}
                        ON DUPLICATE KEY UPDATE score = VALUES(score), definitionVersion = VALUES(definitionVersion), computedAt = VALUES(computedAt)`,
                        [key, definitionVersion, asOf, ...score.parameters, ...source.parameters],
                    );
                    await tx.query("DELETE FROM ranking_score WHERE rankingKey = ? AND computedAt < ?", [key, asOf]);
                });
                break;
            } catch (err: any) {
                attempts++;
                if (err?.code === "ER_LOCK_DEADLOCK" && attempts < 3) {
                    await new Promise((r) => setTimeout(r, 50 * attempts));
                    continue;
                }
                throw err;
            }
        }
    }

    async findRankings(
        actorId: string | undefined,
        dto: StatisticsRankingsRequestDto,
    ) {
        return this.dataSource.transaction((manager) => this.readRankings(manager, actorId, dto));
    }

    private async readRankings(manager: EntityManager, actorId: string | undefined, dto: StatisticsRankingsRequestDto) {
        const { sourceType, mode } = dto;
        const limit = dto.limit ?? 20;
        const offset = dto.offset ?? 0;
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 10000)
            throw new BadRequestException("Invalid ranking pagination");
        if (sourceType === StatisticsSourceType.GAME && (dto.gameId || dto.authorId || dto.excludeOwn || dto.reviewId))
            throw new BadRequestException("Review filters are not supported for game rankings");
        if (sourceType === StatisticsSourceType.REVIEW && dto.criteria)
            throw new BadRequestException("Game criteria are not supported for review rankings");
        if (dto.gameId !== undefined && (!Number.isSafeInteger(dto.gameId) || dto.gameId < 1))
            throw new BadRequestException("Invalid game filter");
        for (const key of ["ids", "themes", "gameModes", "platforms", "genres"] as const) {
            const values = dto.criteria?.[key] as number[] | undefined;
            if (values?.some((value) => !Number.isSafeInteger(value) || value < 1))
                throw new BadRequestException(`Invalid game ${key} filter`);
        }

        const selectors = Number(dto.period !== undefined) + Number(dto.from !== undefined || dto.to !== undefined);
        if (selectors > 1 || (dto.from === undefined) !== (dto.to === undefined))
            throw new BadRequestException("Choose one complete ranking interval");
        const period = dto.period ?? (mode === "recent" ? "week" : "week");
        let asOf = new Date();
        let from: Date | null;
        let to = asOf;
        let fromInstant: StatisticsInstant | null;
        let toInstant = statisticsInstantFromDate(to);
        let asOfInstant = toInstant;
        let rankingKey: string | null = null;
        if (dto.from && dto.to) {
            try {
                fromInstant = parseStatisticsInstant(dto.from);
                toInstant = parseStatisticsInstant(dto.to);
            } catch {
                throw new BadRequestException("Ranking interval must be positive and at most 366 days");
            }
            from = fromInstant.date;
            to = toInstant.date;
            if (fromInstant.epochMicros >= toInstant.epochMicros || toInstant.epochMicros - fromInstant.epochMicros > 366n * 86_400_000_000n)
                throw new BadRequestException("Ranking interval must be positive and at most 366 days");
            asOf = to;
            asOfInstant = toInstant;
        } else {
            if (period === "all" && mode === "recent")
                throw new BadRequestException("Recent rankings require a finite interval");
            if (period !== "all" && periodDays[period] === undefined)
                throw new BadRequestException("Unsupported ranking period");
            from = period === "all" ? null : new Date(asOf.getTime() - periodDays[period] * dayMs);
            fromInstant = from ? statisticsInstantFromDate(from) : null;
            rankingKey = `${sourceType}:${mode}:${period}`;
            if (period === "all" || period === "week" || mode === "popular") {
                const [published] = await manager.query(
                    "SELECT computedAt FROM ranking_score WHERE rankingKey = ? LIMIT 1",
                    [rankingKey],
                );
                if (published?.computedAt) {
                    asOf = new Date(published.computedAt);
                    to = asOf;
                    toInstant = statisticsInstantFromDate(to);
                    asOfInstant = toInstant;
                    from = period === "all" ? null : new Date(asOf.getTime() - periodDays[period] * dayMs);
                    fromInstant = from ? statisticsInstantFromDate(from) : null;
                } else {
                    rankingKey = null;
                }
            } else rankingKey = null;
        }

        if (dto.from && dto.to) fromInstant = parseStatisticsInstant(dto.from);

        if (mode === "recent" && from === null)
            throw new BadRequestException("Recent rankings require a finite interval");
        const score = rankingKey
            ? { sql: "SELECT targetId, score FROM ranking_score WHERE rankingKey = ?", parameters: [rankingKey] }
            : this.scoreQuery(mode, fromInstant, toInstant, fromInstant === null);
        const source = this.sourceQuery(sourceType, dto, actorId);
        const cacheKey = this.cacheKey(actorId, dto, fromInstant, toInstant);
        const countRows = await manager.query(
            `SELECT COUNT(*) AS total ${source.from} WHERE ${source.where}`,
            source.parameters,
        );
        const total = safeCount(countRows[0]?.total ?? 0);
        const cached = await this.cache?.get<any>(cacheKey).catch(() => undefined);
        if (cached && cached.total === total && (!rankingKey || cached.asOf === asOfInstant.iso)) {
            const ids = cached.items.map((item: any) => item.sourceId);
            const memberCount = ids.length
                ? await this.countCachedMembers(manager, source, ids)
                : offset >= total
                  ? 0
                  : -1;
            if (memberCount === ids.length) {
                const freshness = await this.freshness(manager);
                return this.response(
                    cached.items,
                    total,
                    limit,
                    offset,
                    mode,
                    parseStatisticsInstant(cached.asOf),
                    cached.effectiveFrom ? parseStatisticsInstant(cached.effectiveFrom) : null,
                    parseStatisticsInstant(cached.effectiveTo),
                    freshness,
                );
            }
        }

        const order = sourceType === StatisticsSourceType.REVIEW && dto.reviewId
            ? `CASE WHEN ${source.alias}.id = ? THEN 0 ELSE 1 END, score DESC, ${source.alias}.id ASC`
            : `score DESC, ${source.alias}.id ASC`;
        const orderParameters = sourceType === StatisticsSourceType.REVIEW && dto.reviewId ? [dto.reviewId] : [];
        const scoreJoin = `LEFT JOIN (${score.sql}) prepared ON prepared.targetId = t.id`;
        const metricJoins = `LEFT JOIN metric_total views ON views.targetId = t.id AND views.metricCode = 'views'
            LEFT JOIN metric_total likes ON likes.targetId = t.id AND likes.metricCode = 'likes_current'`;
        const rows = sourceType === StatisticsSourceType.GAME
            ? await this.gameRankingPage(manager, source, score, limit, offset)
            : await manager.query(
                `SELECT ${source.alias}.id AS sourceId, COALESCE(prepared.score, 0) AS score,
                    COALESCE(views.metricValue, 0) AS viewsCount, COALESCE(likes.metricValue, 0) AS likesCount
                ${source.from} ${scoreJoin} ${metricJoins}
                WHERE ${source.where}
                ORDER BY ${order} LIMIT ? OFFSET ?`,
                [...score.parameters, ...source.parameters, ...orderParameters, limit, offset],
            );
        const items = rows.map((row: any) => {
            const sourceId = sourceType === StatisticsSourceType.GAME ? safeCount(row.sourceId) : String(row.sourceId);
            const score = Number(row.score);
            if (!Number.isFinite(score) || score < 0) throw new Error("Ranking score is outside the supported numeric range");
            if (sourceType === StatisticsSourceType.GAME && typeof sourceId === "number" && sourceId < 1)
                throw new Error("Invalid game source identity");
            return {
                sourceType,
                sourceId,
                score,
                viewsCount: safeCount(row.viewsCount),
                likesCount: safeCount(row.likesCount),
            };
        });
        await this.cache?.set(cacheKey, {
            items,
            total,
            asOf: asOfInstant.iso,
            effectiveFrom: fromInstant?.iso ?? null,
            effectiveTo: toInstant.iso,
        }, 15 * 60_000).catch(() => undefined);
        const freshness = await this.freshness(manager);
        return this.response(items, total, limit, offset, mode, asOfInstant, fromInstant, toInstant, freshness);
    }

    private async gameRankingPage(manager: EntityManager, source: SourceQuery, score: ScoreQuery, limit: number, offset: number) {
        const positiveJoin = `JOIN (${score.sql}) prepared ON prepared.targetId = t.id AND prepared.score > 0`;
        const parameters = [...score.parameters, ...source.parameters];
        const rows = await manager.query(
            `SELECT g.id AS sourceId, t.id AS targetId, prepared.score
             ${source.from} ${positiveJoin} WHERE ${source.where}
             ORDER BY prepared.score DESC, g.id ASC LIMIT ? OFFSET ?`,
            [...parameters, limit, offset],
        );
        if (rows.length < limit) {
            let positiveCount = offset + rows.length;
            if (offset > 0 && rows.length === 0) {
                const [count] = await manager.query(
                    `SELECT COUNT(*) AS total ${source.from} ${positiveJoin} WHERE ${source.where}`,
                    parameters,
                );
                positiveCount = safeCount(count.total);
            }
            const zeros = await manager.query(
                `SELECT STRAIGHT_JOIN g.id AS sourceId, t.id AS targetId, 0 AS score
                 ${source.from} LEFT ${positiveJoin}
                 WHERE ${source.where} AND prepared.targetId IS NULL
                 ORDER BY g.id ASC LIMIT ? OFFSET ?`,
                [...parameters, limit - rows.length, Math.max(0, offset - positiveCount)],
            );
            rows.push(...zeros);
        }
        if (!rows.length) return rows;
        const metrics = await manager.query(
            `SELECT t.id AS targetId, COALESCE(views.metricValue, 0) AS viewsCount,
                COALESCE(likes.metricValue, 0) AS likesCount
             FROM statistics_target t
             LEFT JOIN metric_total views ON views.targetId = t.id AND views.metricCode = 'views'
             LEFT JOIN metric_total likes ON likes.targetId = t.id AND likes.metricCode = 'likes_current'
             WHERE t.id IN (?)`,
            [rows.map((row: any) => row.targetId)],
        );
        const byTarget = new Map<number, any>(metrics.map((row: any) => [row.targetId, row]));
        return rows.map((row: any) => ({ ...row, ...byTarget.get(row.targetId) }));
    }

    private sourceQuery(
        sourceType: StatisticsSourceType.GAME | StatisticsSourceType.REVIEW,
        dto?: StatisticsRankingsRequestDto,
        actorId?: string,
    ): SourceQuery {
        if (sourceType === StatisticsSourceType.GAME) {
            const where = [
                "t.sourceType = 'game'",
                "t.isActive = 1",
                `NOT EXISTS (SELECT 1 FROM game_themes_game_theme mature WHERE mature.gameId = g.id AND mature.gameThemeId = ${MATURE_THEME_ID})`,
            ];
            const parameters: unknown[] = [];
            const criteria = dto?.criteria as GameRankingCriteriaDto | undefined;
            for (const key of ["ids", "status", "category"] as const) {
                const value = criteria?.[key] as unknown[] | undefined;
                if (value?.length) {
                    where.push(`g.${key === "ids" ? "id" : key} IN (?)`);
                    parameters.push(value);
                }
            }
            for (const [key, table, column] of [
                ["themes", "game_themes_game_theme", "gameThemeId"],
                ["gameModes", "game_game_modes_game_mode", "gameModeId"],
                ["platforms", "game_platform_games_game", "gamePlatformId"],
                ["genres", "game_genres_game_genre", "gameGenreId"],
            ] as const) {
                const value = criteria?.[key] as number[] | undefined;
                if (value?.length) {
                    where.push(`EXISTS (SELECT 1 FROM ${table} filter_${key} WHERE filter_${key}.gameId = g.id AND filter_${key}.${column} IN (?))`);
                    parameters.push(value);
                }
            }
            return {
                // Cover eligibility and ID ordering without fetching the full game row for every candidate.
                from: "FROM game g USE INDEX (UQ_game_statistics_target, IDX_game_statistics_ranking) STRAIGHT_JOIN statistics_target t ON t.id = g.statisticsTargetId",
                where: where.join(" AND "),
                parameters,
                id: "g.id",
                alias: "g",
            };
        }
        const where = [
            "t.sourceType = 'review'",
            "t.isActive = 1",
            `(NOT EXISTS (SELECT 1 FROM collection_entry_collections_collection m WHERE m.collectionEntryId = r.collectionEntryId)
              OR EXISTS (SELECT 1 FROM collection_entry_collections_collection m JOIN collection c ON c.id = m.collectionId
                         WHERE m.collectionEntryId = r.collectionEntryId AND c.isPublic = 1))`,
        ];
        const parameters: unknown[] = [];
        if (dto?.gameId !== undefined) {
            where.push("r.gameId = ?");
            parameters.push(dto.gameId);
        }
        if (dto?.authorId) {
            where.push("r.profileUserId = ?");
            parameters.push(dto.authorId);
        }
        if (dto?.excludeOwn && actorId) {
            where.push("r.profileUserId <> ?");
            parameters.push(actorId);
        }
        return {
            from: "FROM review r JOIN statistics_target t ON t.id = r.statisticsTargetId",
            where: where.join(" AND "),
            parameters,
            id: "r.id",
            alias: "r",
        };
    }

    private scoreQuery(mode: string, from: Date | StatisticsInstant | null, to: Date | StatisticsInstant, all = false): ScoreQuery {
        if (all && mode === "popular")
            return {
                sql: `SELECT targetId, SUM(CASE metricCode WHEN 'views' THEN metricValue WHEN 'like_credit' THEN metricValue * 5 ELSE 0 END) AS score
                    FROM metric_total WHERE metricCode IN ('views', 'like_credit') GROUP BY targetId`,
                parameters: [],
            };
        if (!from) throw new BadRequestException("A finite period is required");
        const fromInstant = from instanceof Date ? statisticsInstantFromDate(from) : from;
        const toInstant = to instanceof Date ? statisticsInstantFromDate(to) : to;
        const fromMicros = fromInstant.epochMicros;
        const toMicros = toInstant.epochMicros;
        const floorFrom = floorStatisticsMicros(fromMicros, statisticsMicrosPerHour);
        const floorTo = floorStatisticsMicros(toMicros, statisticsMicrosPerHour);
        const interiorFrom = fromMicros === floorFrom ? floorFrom : floorFrom + statisticsMicrosPerHour;
        const interiorTo = floorTo;
        const segments: Array<[StatisticsInstant, StatisticsInstant]> = [];
        if (interiorFrom >= interiorTo) segments.push([fromInstant, toInstant]);
        else {
            if (fromMicros < interiorFrom)
                segments.push([fromInstant, statisticsInstantAtMicros(interiorFrom)]);
            if (interiorTo < toMicros)
                segments.push([statisticsInstantAtMicros(interiorTo), toInstant]);
        }
        const parts: string[] = [];
        const parameters: unknown[] = [];
        if (interiorFrom < interiorTo) {
            const decay = mode === "recent" ? " * POW(0.5, TIMESTAMPDIFF(MICROSECOND, bucketStart, ?) / 86400000000.0)" : "";
            parts.push(`SELECT targetId, SUM((CASE metricCode WHEN 'views' THEN metricValue WHEN 'like_credit' THEN metricValue * 5 ELSE 0 END)${decay}) AS score
                FROM metric_hour WHERE metricCode IN ('views', 'like_credit') AND bucketStart >= ? AND bucketStart < ? GROUP BY targetId`);
            if (mode === "recent") parameters.push(toInstant.mysql);
            parameters.push(statisticsInstantAtMicros(interiorFrom).mysql, statisticsInstantAtMicros(interiorTo).mysql);
        }
        for (const [start, end] of segments) {
            if (start.epochMicros >= end.epochMicros) continue;
            const bucket = "TIMESTAMP(DATE_FORMAT(occurredAt, '%Y-%m-%d %H:00:00'))";
            const decay = mode === "recent" ? ` * POW(0.5, TIMESTAMPDIFF(MICROSECOND, ${bucket}, ?) / 86400000000.0)` : "";
            parts.push(`SELECT targetId, SUM((CASE WHEN eventKind = 'view.recorded' THEN 1 WHEN eventKind = 'like.added' AND firstLikeCredit = 1 THEN 5 ELSE 0 END)${decay}) AS score
                FROM statistics_event WHERE projectionState = 'done' AND occurredAt >= ? AND occurredAt < ?
                  AND (eventKind = 'view.recorded' OR (eventKind = 'like.added' AND firstLikeCredit = 1)) GROUP BY targetId`);
            if (mode === "recent") parameters.push(toInstant.mysql);
            parameters.push(start.mysql, end.mysql);
        }
        if (!parts.length) return { sql: "SELECT NULL AS targetId, 0 AS score WHERE 1 = 0", parameters: [] };
        return {
            sql: `SELECT targetId, SUM(score) AS score FROM (${parts.join(" UNION ALL ")}) contributions GROUP BY targetId`,
            parameters,
        };
    }

    private async countCachedMembers(manager: EntityManager, source: SourceQuery, ids: Array<string | number>) {
        const rows = await manager.query(
            `SELECT COUNT(*) AS count ${source.from} WHERE ${source.where} AND ${source.id} IN (?)`,
            [...source.parameters, ids],
        );
        return Number(rows[0]?.count ?? 0);
    }

    private cacheKey(
        actorId: string | undefined,
        dto: StatisticsRankingsRequestDto,
        fromInstant: StatisticsInstant | null,
        toInstant: StatisticsInstant,
    ) {
        const filter = {
            definitionVersion,
            sourceType: dto.sourceType,
            mode: dto.mode,
            period: dto.period,
            range: dto.from && dto.to
                ? [fromInstant?.iso ?? null, toInstant.iso]
                : `preset:${dto.period ?? "week"}`,
            criteria: dto.criteria,
            gameId: dto.gameId,
            authorId: dto.authorId,
            excludeOwn: dto.excludeOwn,
            reviewId: dto.reviewId,
            limit: dto.limit,
            offset: dto.offset,
            actorId: dto.sourceType === StatisticsSourceType.REVIEW && dto.excludeOwn ? actorId ?? null : null,
        };
        const digest = createHash("sha256").update(JSON.stringify(filter)).digest("hex");
        return `statistics:rank:${definitionVersion}:${digest}`;
    }

    private async freshness(manager: EntityManager) {
        const [row] = await manager.query(
            `SELECT SUM(projectionState = 'failed') AS failedCount,
                MIN(CASE WHEN projectionState = 'pending' THEN recordedAt END) AS oldestPendingAt
             FROM statistics_event WHERE projectionState IN ('pending', 'failed')`,
        );
        const oldest = row.oldestPendingAt ? new Date(row.oldestPendingAt).getTime() : null;
        return {
            projectionLagSeconds: oldest === null ? 0 : Math.max(0, (Date.now() - oldest) / 1000),
            hasFailedEvents: Number(row.failedCount || 0) > 0,
            historyComplete: true,
            completeSince: null,
        };
    }

    private response(items: unknown[], total: number, limit: number, offset: number, mode: string, asOf: StatisticsInstant, from: StatisticsInstant | null, to: StatisticsInstant, freshness: any) {
        return {
            items,
            pagination: { total, limit, offset, hasNextPage: offset + items.length < total },
            mode,
            definitionVersion,
            asOf: asOf.iso,
            effectiveFrom: from?.iso ?? null,
            effectiveTo: to.iso,
            ...freshness,
        };
    }
}
