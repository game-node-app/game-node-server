import {
    BadRequestException,
    ConflictException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { StatisticsSourceType } from "./statistics.constants";
import { ReactionRequestDto, ReactionResponseDto } from "./dto/reaction-request.dto";
import {
    StatisticsGranularity,
    StatisticsMetricCode,
    StatisticsSeriesRequestDto,
    StatisticsSourceRequestDto,
    StatisticsViewRequestDto,
} from "./dto/statistics-api.dto";
import {
    lockNotificationComment,
    lockNotificationRoot,
    NotificationRootType,
} from "../notifications/notifications-lifecycle.service";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { ensureStatisticsTarget } from "./statistics-target.repository";
import {
    parseMySqlStatisticsInstant,
    parseStatisticsInstant,
    statisticsInstantAtMicros,
} from "./statistics-time";

type SourceContext = {
    targetId: number;
    ownerUserId: string | null;
    rootType: string;
    rootId: string;
};

const sourceTables: Record<StatisticsSourceType, { table: string; id: string }> = {
    [StatisticsSourceType.GAME]: { table: "game", id: "id" },
    [StatisticsSourceType.REVIEW]: { table: "review", id: "id" },
    [StatisticsSourceType.ACTIVITY]: { table: "activity", id: "id" },
    [StatisticsSourceType.POST]: { table: "post", id: "id" },
    [StatisticsSourceType.REVIEW_COMMENT]: { table: "review_comment", id: "id" },
    [StatisticsSourceType.ACTIVITY_COMMENT]: { table: "activity_comment", id: "id" },
    [StatisticsSourceType.POST_COMMENT]: { table: "post_comment", id: "id" },
};

function validateSourceId(sourceType: StatisticsSourceType, sourceId: string | number) {
    if (sourceType === StatisticsSourceType.GAME) {
        if (
            (typeof sourceId !== "number" &&
                (typeof sourceId !== "string" || !/^[1-9]\d*$/.test(sourceId))) ||
            !Number.isSafeInteger(Number(sourceId)) ||
            Number(sourceId) < 1
        )
            throw new BadRequestException("Invalid source identity");
        return;
    }
    if (typeof sourceId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceId))
        throw new BadRequestException("Invalid source identity");
}

function assertSafeCount(value: unknown): number {
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count < 0)
        throw new Error("Statistics count is outside the safe numeric range");
    return count;
}

function isoUtc(value: Date) {
    return value.toISOString();
}

function floorUtc(value: Date, granularity: StatisticsGranularity) {
    const date = new Date(value);
    date.setUTCMinutes(0, 0, 0);
    if (granularity === StatisticsGranularity.DAY) date.setUTCHours(0);
    return date;
}

function addBucket(value: Date, granularity: StatisticsGranularity) {
    return new Date(value.getTime() + (granularity === StatisticsGranularity.HOUR ? 3_600_000 : 86_400_000));
}

@Injectable()
export class StatisticsService {
    constructor(private readonly dataSource: DataSource) {}

    async applyReaction(
        userId: string,
        dto: ReactionRequestDto,
        isLike: boolean,
    ): Promise<ReactionResponseDto> {
        if (Object.keys(dto).some((key) => !["sourceType", "sourceId"].includes(key)))
            throw new BadRequestException("Unknown property");
        if (!Object.values(StatisticsSourceType).includes(dto.sourceType))
            throw new BadRequestException("Unsupported source type");
        validateSourceId(dto.sourceType, dto.sourceId);

        for (let retries = 0; ; retries++) {
            try {
                return await this.dataSource.transaction(async (manager) => {
                    const context = await this.resolveSource(manager, dto, true);
                    const states = await manager.query(
                        "SELECT likedAt, firstLikedAt FROM engagement_state WHERE targetId = ? AND profileUserId = ? FOR UPDATE",
                        [context.targetId, userId],
                    );
                    const state = states[0];
                    const currentlyLiked = Boolean(state?.likedAt);
                    const [gauge] = await manager.query(
                        "SELECT metricValue FROM metric_total WHERE targetId = ? AND metricCode = 'likes_current' FOR UPDATE",
                        [context.targetId],
                    );
                    if (!gauge) throw new Error("Missing active-like gauge");
                    const currentCount = assertSafeCount(gauge.metricValue);
                    if (currentlyLiked === isLike)
                        return { isLiked: currentlyLiked, likesCount: currentCount };
                    if (!isLike && currentCount < 1)
                        throw new Error("Active-like gauge is inconsistent with engagement state");

                    const occurredAt = new Date();
                    const transitionId = randomUUID();
                    const firstLikeCredit = isLike && !state?.firstLikedAt;
                    if (isLike) {
                        await manager.query(
                            `INSERT INTO engagement_state (targetId, profileUserId, likedAt, firstLikedAt)
                            VALUES (?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE likedAt = VALUES(likedAt),
                                firstLikedAt = COALESCE(firstLikedAt, VALUES(firstLikedAt))`,
                            [context.targetId, userId, occurredAt, occurredAt],
                        );
                    } else {
                        await manager.query(
                            "UPDATE engagement_state SET likedAt = NULL WHERE targetId = ? AND profileUserId = ?",
                            [context.targetId, userId],
                        );
                    }
                    const likesCount = currentCount + (isLike ? 1 : -1);
                    await manager.query(
                        "UPDATE metric_total SET metricValue = ? WHERE targetId = ? AND metricCode = 'likes_current'",
                        [likesCount, context.targetId],
                    );
                    const eventKind = isLike ? "like.added" : "like.removed";
                    const inserted = await manager.query(
                        `INSERT INTO statistics_event
                            (eventKey, eventVersion, eventKind, targetId, actorUserId, occurredAt, provenance, firstLikeCredit, projectionState, attempts, nextAttemptAt)
                        VALUES (?, 1, ?, ?, ?, ?, 'live', ?, 'pending', 0, CURRENT_TIMESTAMP(6))`,
                        [`${isLike ? "like" : "unlike"}:${transitionId}`, eventKind, context.targetId, userId, occurredAt, firstLikeCredit ? 1 : 0],
                    );
                    const eventId = assertSafeCount(inserted.insertId);
                    if (isLike && context.ownerUserId && context.ownerUserId !== userId) {
                        const subjectType = dto.sourceType.endsWith("_comment")
                            ? "comment"
                            : dto.sourceType as "post" | "review" | "activity" | "game";
                        await appendNotificationIntent(manager, {
                            id: transitionId,
                            eventType: "content.liked",
                            eventVersion: 1,
                            occurredAt,
                            recipientUserId: context.ownerUserId,
                            actorUserId: userId,
                            payload: {
                                likeId: eventId,
                                subjectType,
                                subjectId: String(dto.sourceId),
                                rootType: context.rootType,
                                rootId: context.rootId,
                            },
                        });
                    }
                    return { isLiked: isLike, likesCount };
                });
            } catch (error: any) {
                const deadlock = error?.code === "ER_LOCK_DEADLOCK" || error?.errno === 1213 || error?.message?.includes("Deadlock");
                if (!deadlock || retries >= 3) throw error;
                await new Promise((resolve) => setTimeout(resolve, 20 * (retries + 1)));
            }
        }
    }

    async recordView(userId: string | undefined, dto: StatisticsViewRequestDto) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dto.viewId))
            throw new BadRequestException("Invalid view identity");
        for (let retries = 0; ; retries++) {
            try {
                return await this.dataSource.transaction(async (manager) => {
                    const context = await this.resolveSource(manager, dto, true);
                    const eventKey = `view:${dto.viewId.toLowerCase()}`;
                    const occurredAt = new Date();
                    await manager.query(
                        `INSERT IGNORE INTO statistics_event
                            (eventKey, eventVersion, eventKind, targetId, actorUserId, occurredAt, provenance, firstLikeCredit, projectionState, attempts, nextAttemptAt)
                        VALUES (?, 1, 'view.recorded', ?, ?, ?, 'live', 0, 'pending', 0, CURRENT_TIMESTAMP(6))`,
                        [eventKey, context.targetId, userId ?? null, occurredAt],
                    );
                    const [event] = await manager.query(
                        "SELECT id, targetId, actorUserId, occurredAt, eventKind FROM statistics_event WHERE eventKey = ? FOR UPDATE",
                        [eventKey],
                    );
                    if (
                        !event ||
                        Number(event.targetId) !== context.targetId ||
                        (event.actorUserId ?? null) !== (userId ?? null) ||
                        event.eventKind !== "view.recorded"
                    )
                        throw new ConflictException("View identity conflict");
                    if (userId) {
                        await manager.query(
                            `INSERT INTO engagement_state (targetId, profileUserId, lastViewedAt)
                            VALUES (?, ?, ?)
                            ON DUPLICATE KEY UPDATE lastViewedAt = GREATEST(COALESCE(lastViewedAt, '1000-01-01'), VALUES(lastViewedAt))`,
                            [context.targetId, userId, event.occurredAt],
                        );
                    }
                    return { accepted: true, viewId: dto.viewId };
                });
            } catch (error: any) {
                const deadlock = error?.code === "ER_LOCK_DEADLOCK" || error?.errno === 1213 || error?.message?.includes("Deadlock");
                if (!deadlock || retries >= 3) throw error;
                await new Promise((resolve) => setTimeout(resolve, 20 * (retries + 1)));
            }
        }
    }

    async getStatus(dto: StatisticsSourceRequestDto, userId?: string) {
        return this.dataSource.transaction(async (manager) => {
            const context = await this.resolveSource(manager, dto, true);
            if (!userId) return { isLiked: false, isViewed: false };
            const [state] = await manager.query(
                "SELECT likedAt, lastViewedAt FROM engagement_state WHERE targetId = ? AND profileUserId = ?",
                [context.targetId, userId],
            );
            return { isLiked: Boolean(state?.likedAt), isViewed: Boolean(state?.lastViewedAt) };
        });
    }

    async findSummary(dto: StatisticsSourceRequestDto) {
        return this.dataSource.transaction(async (manager) => {
            const context = await this.resolveSource(manager, dto, true);
            const [values] = await manager.query(
                `SELECT
                    COALESCE(MAX(CASE WHEN metricCode = 'views' THEN metricValue END), 0) AS viewsCount,
                    COALESCE(MAX(CASE WHEN metricCode = 'likes_current' THEN metricValue END), 0) AS likesCount
                FROM metric_total WHERE targetId = ?`,
                [context.targetId],
            );
            return {
                sourceType: dto.sourceType,
                sourceId: dto.sourceId,
                viewsCount: assertSafeCount(values.viewsCount),
                likesCount: assertSafeCount(values.likesCount),
                ...(await this.freshness(manager, context.targetId)),
            };
        });
    }

    async findSeries(dto: StatisticsSeriesRequestDto) {
        let fromInstant;
        let toInstant;
        try {
            fromInstant = parseStatisticsInstant(dto.from);
            toInstant = parseStatisticsInstant(dto.to);
        } catch {
            throw new BadRequestException("Statistics interval must be positive and at most 366 days");
        }
        const from = fromInstant.date;
        const to = toInstant.date;
        if (fromInstant.epochMicros >= toInstant.epochMicros || toInstant.epochMicros - fromInstant.epochMicros > 366n * 86_400_000_000n)
            throw new BadRequestException("Statistics interval must be positive and at most 366 days");
        if (!Object.values(StatisticsMetricCode).includes(dto.metric) || !Object.values(StatisticsGranularity).includes(dto.granularity))
            throw new BadRequestException("Unsupported statistics metric or granularity");

        return this.dataSource.transaction(async (manager) => {
            const context = await this.resolveSource(manager, dto, true);
            const first = floorUtc(from, dto.granularity);
            const last = floorUtc(statisticsInstantAtMicros(toInstant.epochMicros - 1n).date, dto.granularity);
            const starts: Date[] = [];
            for (let bucket = first; bucket <= last; bucket = addBucket(bucket, dto.granularity)) starts.push(bucket);
            const values = new Map(starts.map((bucket) => [bucket.toISOString(), 0]));
            const bucketStartMicros = (bucket: Date) => BigInt(bucket.getTime()) * 1_000n;
            const interior = starts.filter((bucket) =>
                bucketStartMicros(bucket) >= fromInstant.epochMicros &&
                bucketStartMicros(addBucket(bucket, dto.granularity)) <= toInstant.epochMicros,
            );
            let edgeRanges: Array<[string, string]>;
            if (!interior.length) edgeRanges = [[fromInstant.mysql, toInstant.mysql]];
            else {
                edgeRanges = [];
                const interiorStartMicros = bucketStartMicros(interior[0]);
                const interiorEndMicros = bucketStartMicros(addBucket(interior[interior.length - 1], dto.granularity));
                if (fromInstant.epochMicros < interiorStartMicros)
                    edgeRanges.push([fromInstant.mysql, statisticsInstantAtMicros(interiorStartMicros).mysql]);
                if (interiorEndMicros < toInstant.epochMicros)
                    edgeRanges.push([statisticsInstantAtMicros(interiorEndMicros).mysql, toInstant.mysql]);
            }

            if (interior.length) {
                const hourFrom = statisticsInstantAtMicros(bucketStartMicros(interior[0])).mysql;
                const hourTo = statisticsInstantAtMicros(bucketStartMicros(addBucket(interior[interior.length - 1], dto.granularity))).mysql;
                const rows = await manager.query(
                    `SELECT bucketStart, SUM(metricValue) AS metricValue FROM metric_hour
                    WHERE targetId = ? AND metricCode = ? AND bucketStart >= ? AND bucketStart < ?
                    GROUP BY bucketStart`,
                    [context.targetId, dto.metric, hourFrom, hourTo],
                );
                for (const row of rows) {
                    const bucket = floorUtc(new Date(row.bucketStart), dto.granularity).toISOString();
                    values.set(bucket, (values.get(bucket) ?? 0) + assertSafeCount(row.metricValue));
                }
            }
            for (const [edgeFrom, edgeTo] of edgeRanges) {
                const rows = await manager.query(
                    `SELECT ${dto.granularity === StatisticsGranularity.HOUR
                        ? "DATE_FORMAT(occurredAt, '%Y-%m-%d %H:00:00')"
                        : "DATE_FORMAT(occurredAt, '%Y-%m-%d 00:00:00')"} AS bucketStart,
                        SUM(${this.metricExpression(dto.metric)}) AS metricValue
                    FROM statistics_event WHERE targetId = ? AND projectionState = 'done' AND occurredAt >= ? AND occurredAt < ?
                      AND (eventKind = 'view.recorded' OR eventKind IN ('like.added', 'like.removed'))
                    GROUP BY bucketStart`,
                    [context.targetId, edgeFrom, edgeTo],
                );
                for (const row of rows) {
                    const bucket = floorUtc(new Date(`${row.bucketStart}Z`), dto.granularity).toISOString();
                    values.set(bucket, assertSafeCount(row.metricValue));
                }
            }
            return {
                sourceType: dto.sourceType,
                sourceId: dto.sourceId,
                metric: dto.metric,
                from: fromInstant.iso,
                to: toInstant.iso,
                granularity: dto.granularity,
                buckets: starts.map((bucket) => ({ start: isoUtc(bucket), value: values.get(bucket.toISOString())! })),
                ...(await this.freshness(manager, context.targetId, fromInstant)),
            };
        });
    }

    private metricExpression(metric: StatisticsMetricCode) {
        switch (metric) {
            case StatisticsMetricCode.VIEWS: return "eventKind = 'view.recorded'";
            case StatisticsMetricCode.LIKES_ADDED: return "eventKind = 'like.added'";
            case StatisticsMetricCode.LIKES_REMOVED: return "eventKind = 'like.removed'";
            case StatisticsMetricCode.LIKE_CREDIT: return "eventKind = 'like.added' AND firstLikeCredit = 1";
        }
    }

    private async freshness(manager: EntityManager, targetId?: number, from?: ReturnType<typeof parseStatisticsInstant>) {
        const targetFilter = targetId === undefined ? "" : " AND targetId = ?";
        const parameters = targetId === undefined ? [] : [targetId];
        const [row] = await manager.query(
            `SELECT SUM(projectionState = 'failed') AS failedCount,
                MIN(CASE WHEN projectionState = 'pending' THEN recordedAt END) AS oldestPendingAt
            FROM statistics_event WHERE projectionState IN ('pending', 'failed')${targetFilter}`,
            parameters,
        );
        const [maintenance] = await manager.query(
            "SELECT DATE_FORMAT(historyCompleteSince, '%Y-%m-%dT%H:%i:%s.%fZ') AS historyCompleteSince FROM statistics_maintenance WHERE id = 'main'",
        );
        const completeSince = maintenance?.historyCompleteSince
            ? parseMySqlStatisticsInstant(String(maintenance.historyCompleteSince).replace(/Z$/, "")).iso
            : null;
        const incompleteFrom = completeSince ? parseStatisticsInstant(completeSince) : null;
        const oldest = row.oldestPendingAt ? new Date(row.oldestPendingAt).getTime() : null;
        return {
            asOf: new Date().toISOString(),
            projectionLagSeconds: oldest === null ? 0 : Math.max(0, (Date.now() - oldest) / 1000),
            hasFailedEvents: Number(row.failedCount || 0) > 0,
            historyComplete: !incompleteFrom || Boolean(from && from.epochMicros >= incompleteFrom.epochMicros),
            completeSince,
        };
    }

    private async resolveSource(
        manager: EntityManager,
        dto: StatisticsSourceRequestDto,
        initialize: boolean,
    ): Promise<SourceContext> {
        validateSourceId(dto.sourceType, dto.sourceId);
        let ownerUserId: string | null = null;
        let rootType = String(dto.sourceType);
        let rootId = String(dto.sourceId);
        if (dto.sourceType === StatisticsSourceType.GAME) {
            const [game] = await manager.query("SELECT id FROM game WHERE id = ? FOR UPDATE", [dto.sourceId]);
            if (!game) throw new NotFoundException("Source not found or inaccessible");
        } else if ([StatisticsSourceType.POST, StatisticsSourceType.REVIEW, StatisticsSourceType.ACTIVITY].includes(dto.sourceType)) {
            const root = await lockNotificationRoot(manager, dto.sourceType as NotificationRootType, String(dto.sourceId));
            if (!root) throw new NotFoundException("Source not found or inaccessible");
            ownerUserId = root.profileUserId;
        } else {
            const rootTypeValue = dto.sourceType.replace("_comment", "") as NotificationRootType;
            if (!["post", "review", "activity"].includes(rootTypeValue)) throw new BadRequestException("Unsupported source type");
            const table = sourceTables[dto.sourceType].table;
            const [comment] = await manager.query(`SELECT ${rootTypeValue}Id AS rootId FROM ${table} WHERE id = ?`, [dto.sourceId]);
            if (!comment) throw new NotFoundException("Source not found or inaccessible");
            rootId = comment.rootId;
            rootType = rootTypeValue;
            const locked = await lockNotificationComment(manager, rootTypeValue, rootId, String(dto.sourceId));
            if (!locked) throw new NotFoundException("Source not found or inaccessible");
            ownerUserId = locked.profileUserId;
        }
        const targetId = initialize
            ? await ensureStatisticsTarget(manager, dto.sourceType, dto.sourceId)
            : null;
        if (!targetId) throw new NotFoundException("Source not found or inaccessible");
        return { targetId, ownerUserId, rootType, rootId };
    }
}
