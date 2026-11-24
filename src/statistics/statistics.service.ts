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
    StatisticsBatchSummaryRequestDto,
    StatisticsGranularity,
    StatisticsMetricCode,
    StatisticsSeriesRequestDto,
    StatisticsSourceRequestDto,
    StatisticsViewRequestDto,
} from "./dto/statistics-api.dto";
import {
    lockNotificationComment,
    lockNotificationRoot,
    NotificationRootAccess,
    NotificationRootType,
} from "../notifications/notifications-lifecycle.service";
import { LibraryAccessService } from "../libraries/library-access.service";
import { entryVisibilitySql } from "../libraries/library-visibility.constants";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { ensureStatisticsTarget } from "./statistics-target.repository";
import {
    parseStatisticsInstant,
    statisticsInstantAtMicros,
} from "./statistics-time";

type SourceContext = {
    targetId: number;
    ownerUserId: string | null;
    rootType: string;
    rootId: string;
};

type ReadableSource = {
    sourceId: string | number;
    targetId: number | null;
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
    constructor(
        private readonly dataSource: DataSource,
        private readonly libraryAccessService: LibraryAccessService,
    ) {}

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
                    const context = await this.resolveSource(manager, dto, true, {
                        viewerId: userId,
                        libraryAccess: this.libraryAccessService,
                    });
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
                            (eventKey, eventVersion, eventKind, targetId, actorUserId, occurredAt, firstLikeCredit, projectionState, attempts, nextAttemptAt)
                        VALUES (?, 1, ?, ?, ?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP(6))`,
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
                            (eventKey, eventVersion, eventKind, targetId, actorUserId, occurredAt, firstLikeCredit, projectionState, attempts, nextAttemptAt)
                        VALUES (?, 1, 'view.recorded', ?, ?, ?, 0, 'pending', 0, CURRENT_TIMESTAMP(6))`,
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

    async findSummary(dto: StatisticsSourceRequestDto, userId?: string) {
        validateSourceId(dto.sourceType, dto.sourceId);
        const manager = this.dataSource.manager;
        const sources = await this.readReadableSources(
            manager,
            dto.sourceType,
            [dto.sourceId],
            userId,
        );
        const source = sources.get(this.sourceKey(dto.sourceId));
        if (!source) throw new NotFoundException("Source not found or inaccessible");
        const totals =
            source.targetId === null
                ? undefined
                : (await this.readMetricTotals(manager, [source.targetId])).get(source.targetId);
        const commentsCount =
            (await this.readCommentCounts(manager, dto.sourceType, [dto.sourceId])).get(
                this.sourceKey(dto.sourceId),
            ) ?? 0;
        return {
            sourceType: dto.sourceType,
            sourceId: dto.sourceId,
            viewsCount: totals?.viewsCount ?? 0,
            likesCount: totals?.likesCount ?? 0,
            commentsCount,
            ...(await this.freshness(manager, source.targetId ?? undefined)),
        };
    }

    async findBatchSummary(dto: StatisticsBatchSummaryRequestDto, userId?: string) {
        const sourceIds: Array<string | number> = [];
        const seen = new Set<string>();
        for (const sourceId of dto.sourceIds) {
            const key = this.sourceKey(sourceId);
            if (seen.has(key)) continue;
            seen.add(key);
            sourceIds.push(sourceId);
        }
        for (const sourceId of sourceIds) validateSourceId(dto.sourceType, sourceId);
        const manager = this.dataSource.manager;
        const sources = await this.readReadableSources(manager, dto.sourceType, sourceIds, userId);
        const readableIds = sourceIds.filter((sourceId) => sources.has(this.sourceKey(sourceId)));
        const comments = await this.readCommentCounts(manager, dto.sourceType, readableIds);
        const targetIds = [
            ...new Set(
                readableIds
                    .map((sourceId) => sources.get(this.sourceKey(sourceId))!.targetId)
                    .filter((targetId): targetId is number => targetId !== null),
            ),
        ];
        const totals = await this.readMetricTotals(manager, targetIds);
        const states = await this.readViewerStates(manager, targetIds, userId);
        return {
            items: readableIds.map((sourceId) => {
                const targetId = sources.get(this.sourceKey(sourceId))!.targetId;
                const total = targetId === null ? undefined : totals.get(targetId);
                const state = targetId === null ? undefined : states.get(targetId);
                return {
                    sourceType: dto.sourceType,
                    sourceId,
                    viewsCount: total?.viewsCount ?? 0,
                    likesCount: total?.likesCount ?? 0,
                    commentsCount: comments.get(this.sourceKey(sourceId)) ?? 0,
                    isLiked: state?.isLiked ?? false,
                    isViewed: state?.isViewed ?? false,
                };
            }),
            ...(await this.freshness(manager)),
        };
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
                ...(await this.freshness(manager, context.targetId)),
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

    private sourceKey(sourceId: string | number) {
        return String(sourceId).toLowerCase();
    }

    /**
     * Read-only source resolution: existence and visibility checks without locks or target
     * writes. Activity visibility mirrors `lockNotificationRoot`, including followers entries
     * inside public libraries.
     */
    private async readReadableSources(
        manager: EntityManager,
        sourceType: StatisticsSourceType,
        sourceIds: ReadonlyArray<string | number>,
        viewerId?: string,
    ): Promise<Map<string, ReadableSource>> {
        const readable = new Map<string, ReadableSource>();
        if (!sourceIds.length) return readable;
        const queryIds = [...sourceIds];
        const add = (row: any) => {
            const targetId =
                row.statisticsTargetId === null || row.statisticsTargetId === undefined
                    ? null
                    : Number(row.statisticsTargetId);
            if (targetId !== null && (!Number.isSafeInteger(targetId) || targetId < 1))
                throw new Error("Statistics target id is outside the safe numeric range");
            readable.set(this.sourceKey(row.id), { sourceId: row.id, targetId });
        };

        if (sourceType === StatisticsSourceType.GAME) {
            const rows = await manager.query(
                "SELECT id, statisticsTargetId FROM game WHERE id IN (?)",
                [queryIds],
            );
            for (const row of rows) add(row);
        } else if (sourceType === StatisticsSourceType.POST) {
            const rows = await manager.query(
                "SELECT id, statisticsTargetId FROM post WHERE id IN (?) AND deletedAt IS NULL",
                [queryIds],
            );
            for (const row of rows) add(row);
        } else if (sourceType === StatisticsSourceType.REVIEW) {
            const rows = await manager.query(
                "SELECT id, statisticsTargetId FROM review WHERE id IN (?)",
                [queryIds],
            );
            for (const row of rows) add(row);
        } else if (sourceType === StatisticsSourceType.ACTIVITY) {
            const rows = await manager.query(
                `SELECT id, postId, reviewId, collectionId, collectionEntryId, statisticsTargetId
                FROM activity WHERE id IN (?)`,
                [queryIds],
            );
            for (const row of await this.filterAccessibleActivities(manager, rows, viewerId)) add(row);
        } else {
            const rootType = sourceType.replace("_comment", "") as NotificationRootType;
            if (!["post", "review", "activity"].includes(rootType))
                throw new BadRequestException("Unsupported source type");
            const rows = await manager.query(
                `SELECT id, ${rootType}Id AS rootId, statisticsTargetId
                FROM ${sourceTables[sourceType].table} WHERE id IN (?)`,
                [queryIds],
            );
            const rootIds: string[] = [
                ...new Set<string>(rows.map((row: any) => String(row.rootId))),
            ];
            const accessibleRootIds = await this.readAccessibleContentIds(
                manager,
                rootType,
                rootIds,
                viewerId,
            );
            for (const row of rows) {
                if (accessibleRootIds.has(String(row.rootId))) add(row);
            }
        }
        return readable;
    }

    private async filterAccessibleActivities(
        manager: EntityManager,
        rows: any[],
        viewerId?: string,
    ): Promise<any[]> {
        if (!rows.length) return rows;
        const distinct = (values: unknown[]) => [
            ...new Set(values.filter(Boolean).map(String)),
        ];
        const postIds = distinct(rows.map((row) => row.postId));
        const reviewIds = distinct(rows.map((row) => row.reviewId));
        const collectionIds = distinct(rows.map((row) => row.collectionId));
        const entryIds = distinct(rows.map((row) => row.collectionEntryId));
        const posts = await this.readAccessibleContentIds(manager, "post", postIds, viewerId);
        const reviews = await this.readAccessibleContentIds(manager, "review", reviewIds, viewerId);
        const collections = await this.readAccessibleCollectionIds(manager, collectionIds, viewerId);
        const entries = await this.readAccessibleCollectionEntryIds(manager, entryIds, viewerId);
        return rows.filter(
            (row) =>
                (!row.postId || posts.has(String(row.postId))) &&
                (!row.reviewId || reviews.has(String(row.reviewId))) &&
                (!row.collectionId || collections.has(String(row.collectionId))) &&
                (!row.collectionEntryId || entries.has(String(row.collectionEntryId))),
        );
    }

    private async readAccessibleContentIds(
        manager: EntityManager,
        contentType: NotificationRootType,
        ids: string[],
        viewerId?: string,
    ): Promise<Set<string>> {
        if (!ids.length) return new Set();
        if (contentType === "post") {
            const rows = await manager.query(
                "SELECT id FROM post WHERE id IN (?) AND deletedAt IS NULL",
                [ids],
            );
            return new Set(rows.map((row: any) => String(row.id)));
        }
        if (contentType === "review") {
            const rows = await manager.query("SELECT id FROM review WHERE id IN (?)", [ids]);
            return new Set(rows.map((row: any) => String(row.id)));
        }
        const rows = await manager.query(
            `SELECT id, postId, reviewId, collectionId, collectionEntryId
            FROM activity WHERE id IN (?)`,
            [ids],
        );
        const accessible = await this.filterAccessibleActivities(manager, rows, viewerId);
        return new Set(accessible.map((row: any) => String(row.id)));
    }

    private async readAccessibleCollectionIds(
        manager: EntityManager,
        ids: string[],
        viewerId?: string,
    ): Promise<Set<string>> {
        if (!ids.length) return new Set();
        const rows = await manager.query(
            `SELECT c.id FROM collection c
            LEFT JOIN profile p ON p.userId = c.libraryUserId
            WHERE c.id IN (?) AND c.isPublic = 1
              AND (
                c.libraryUserId = ?
                OR p.libraryVisibility IS NULL
                OR p.libraryVisibility = 'public'
                OR (p.libraryVisibility = 'followers' AND EXISTS (
                    SELECT 1 FROM user_follow f
                    WHERE f.followerUserId = ? AND f.followedUserId = c.libraryUserId
                ))
              )`,
            [ids, viewerId ?? null, viewerId ?? null],
        );
        return new Set(rows.map((row: any) => String(row.id)));
    }

    private async readAccessibleCollectionEntryIds(
        manager: EntityManager,
        ids: string[],
        viewerId?: string,
    ): Promise<Set<string>> {
        if (!ids.length) return new Set();
        // entryVisibilitySql binds the viewer twice: library owner and follower checks.
        const rows = await manager.query(
            `SELECT e.id FROM collection_entry e
            WHERE e.id IN (?) AND ${entryVisibilitySql("e", "viewerId").replaceAll(":viewerId", "?")}`,
            [ids, viewerId ?? null, viewerId ?? null],
        );
        return new Set(rows.map((row: any) => String(row.id)));
    }

    private async readCommentCounts(
        manager: EntityManager,
        sourceType: StatisticsSourceType,
        sourceIds: ReadonlyArray<string | number>,
    ): Promise<Map<string, number>> {
        const counts = new Map<string, number>();
        for (const sourceId of sourceIds) counts.set(this.sourceKey(sourceId), 0);
        if (
            !sourceIds.length ||
            ![
                StatisticsSourceType.REVIEW,
                StatisticsSourceType.ACTIVITY,
                StatisticsSourceType.POST,
            ].includes(sourceType)
        )
            return counts;
        const table = `${sourceType}_comment`;
        const column = `${sourceType}Id`;
        const rows = await manager.query(
            `SELECT ${column} AS sourceId, COUNT(*) AS commentsCount
            FROM ${table} WHERE ${column} IN (?) GROUP BY ${column}`,
            [sourceIds],
        );
        for (const row of rows) {
            const key = this.sourceKey(row.sourceId);
            if (counts.has(key)) counts.set(key, assertSafeCount(row.commentsCount));
        }
        return counts;
    }

    private async readMetricTotals(manager: EntityManager, targetIds: number[]) {
        const totals = new Map<number, { viewsCount: number; likesCount: number }>();
        for (const targetId of targetIds)
            totals.set(targetId, { viewsCount: 0, likesCount: 0 });
        if (!targetIds.length) return totals;
        const rows = await manager.query(
            `SELECT targetId,
                COALESCE(MAX(CASE WHEN metricCode = 'views' THEN metricValue END), 0) AS viewsCount,
                COALESCE(MAX(CASE WHEN metricCode = 'likes_current' THEN metricValue END), 0) AS likesCount
            FROM metric_total WHERE targetId IN (?) GROUP BY targetId`,
            [targetIds],
        );
        for (const row of rows) {
            const total = totals.get(Number(row.targetId));
            if (!total) continue;
            total.viewsCount = assertSafeCount(row.viewsCount);
            total.likesCount = assertSafeCount(row.likesCount);
        }
        return totals;
    }

    private async readViewerStates(
        manager: EntityManager,
        targetIds: number[],
        userId?: string,
    ) {
        const states = new Map<number, { isLiked: boolean; isViewed: boolean }>();
        for (const targetId of targetIds)
            states.set(targetId, { isLiked: false, isViewed: false });
        if (!userId || !targetIds.length) return states;
        const rows = await manager.query(
            `SELECT targetId, likedAt, lastViewedAt FROM engagement_state
            WHERE profileUserId = ? AND targetId IN (?)`,
            [userId, targetIds],
        );
        for (const row of rows) {
            const state = states.get(Number(row.targetId));
            if (!state) continue;
            state.isLiked = Boolean(row.likedAt);
            state.isViewed = Boolean(row.lastViewedAt);
        }
        return states;
    }

    private async freshness(manager: EntityManager, targetId?: number) {
        const targetFilter = targetId === undefined ? "" : " AND targetId = ?";
        const parameters = targetId === undefined ? [] : [targetId];
        const [row] = await manager.query(
            `SELECT SUM(projectionState = 'failed') AS failedCount,
                MIN(CASE WHEN projectionState = 'pending' THEN recordedAt END) AS oldestPendingAt
            FROM statistics_event WHERE projectionState IN ('pending', 'failed')${targetFilter}`,
            parameters,
        );
        const oldest = row.oldestPendingAt ? new Date(row.oldestPendingAt).getTime() : null;
        return {
            asOf: new Date().toISOString(),
            projectionLagSeconds: oldest === null ? 0 : Math.max(0, (Date.now() - oldest) / 1000),
            hasFailedEvents: Number(row.failedCount || 0) > 0,
            historyComplete: true,
            completeSince: null,
        };
    }

    private async resolveSource(
        manager: EntityManager,
        dto: StatisticsSourceRequestDto,
        initialize: boolean,
        access?: NotificationRootAccess,
    ): Promise<SourceContext> {
        validateSourceId(dto.sourceType, dto.sourceId);
        let ownerUserId: string | null = null;
        let rootType = String(dto.sourceType);
        let rootId = String(dto.sourceId);
        if (dto.sourceType === StatisticsSourceType.GAME) {
            const [game] = await manager.query("SELECT id FROM game WHERE id = ? FOR UPDATE", [dto.sourceId]);
            if (!game) throw new NotFoundException("Source not found or inaccessible");
        } else if ([StatisticsSourceType.POST, StatisticsSourceType.REVIEW, StatisticsSourceType.ACTIVITY].includes(dto.sourceType)) {
            const root = await lockNotificationRoot(manager, dto.sourceType as NotificationRootType, String(dto.sourceId), access);
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
            const locked = await lockNotificationComment(manager, rootTypeValue, rootId, String(dto.sourceId), access);
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
