import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { isUUID } from "class-validator";
import { DataSource, EntityManager, QueryRunner } from "typeorm";
import { StatisticsSourceType } from "./statistics.constants";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { STATISTICS_SOURCE_TABLES } from "./statistics-target.repository";
import { parseMySqlStatisticsInstant } from "./statistics-time";

const allowedKinds = ["view.recorded", "like.added", "like.removed"];
const allowedProvenance = ["live", "legacy-recorded", "legacy-job"];
const sourceTypes = Object.values(StatisticsSourceType);
const queueStates = ["wait", "paused", "delayed", "active", "failed", "completed", "waiting-children", "prioritized"];
const legacyLinks = [
    { column: "gameStatisticsId", table: "game_statistics", sourceColumn: "gameId", type: StatisticsSourceType.GAME },
    { column: "reviewStatisticsId", table: "review_statistics", sourceColumn: "reviewId", type: StatisticsSourceType.REVIEW },
    { column: "activityStatisticsId", table: "activity_statistics", sourceColumn: "activityId", type: StatisticsSourceType.ACTIVITY },
    { column: "postStatisticsId", table: "post_statistics", sourceColumn: "postId", type: StatisticsSourceType.POST },
    { column: "commentStatisticsId", table: "comment_statistics", sourceColumn: "reviewCommentId", type: StatisticsSourceType.REVIEW_COMMENT },
    { column: "commentStatisticsId", table: "comment_statistics", sourceColumn: "activityCommentId", type: StatisticsSourceType.ACTIVITY_COMMENT },
    { column: "commentStatisticsId", table: "comment_statistics", sourceColumn: "postCommentId", type: StatisticsSourceType.POST_COMMENT },
];

type ConversionCursor =
    | { phase: "sources"; sourceIndex: number; lastId: string }
    | { phase: "likes" | "views"; lastId: string }
    | { phase: "queue"; state: string; offset: number }
    | { phase: "ready" | "complete" };

type LegacyQueueJob = {
    id: string;
    name: string;
    data: Record<string, unknown>;
    timestamp: number;
};

function readReport(value: unknown): Record<string, any> {
    if (!value) return {};
    if (typeof value === "string") return JSON.parse(value);
    return value as Record<string, any>;
}

function readCursor(value: unknown): ConversionCursor {
    if (!value) return { phase: "sources", sourceIndex: 0, lastId: "" };
    try { return JSON.parse(String(value)) as ConversionCursor; }
    catch { throw new Error("Invalid statistics maintenance checkpoint"); }
}

function safeTargetId(value: unknown): number {
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1)
        throw new Error("Statistics target id is outside the safe numeric range");
    return id;
}

function validLegacySourceId(type: StatisticsSourceType, value: unknown): value is string | number {
    if (type === StatisticsSourceType.GAME)
        return (typeof value === "number" && Number.isSafeInteger(value) && value > 0) ||
            (typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)));
    return typeof value === "string" && isUUID(value);
}

@Injectable()
export class StatisticsMaintenanceService {
    constructor(
        private readonly dataSource: DataSource,
        private readonly rankingService: StatisticsRankingService,
    ) {}

    async rebuild(backupReference: string, resume = false, batchSize = 100): Promise<Record<string, unknown>> {
        this.validateMaintenanceRequest(backupReference, batchSize);

        const runner = this.dataSource.createQueryRunner();
        let lockAcquired = false;
        try {
            await runner.connect();
            await runner.query("SET SESSION innodb_lock_wait_timeout = 2");
            const [lock] = await runner.query("SELECT GET_LOCK('statistics-maintenance', 0) AS acquired");
            if (Number(lock.acquired) !== 1) throw new ConflictException("Another statistics maintenance operation is active");
            lockAcquired = true;
            await this.beginRebuild(runner, backupReference, resume);

            while (true) {
                const [checkpoint] = await runner.query(
                    "SELECT `cursor` FROM statistics_maintenance WHERE id = 'main' AND operation = 'rebuild' AND state = 'running'",
                );
                if (!checkpoint) throw new Error("Statistics rebuild checkpoint was lost");
                const targets = await runner.query(
                    "SELECT id FROM statistics_target WHERE id > ? ORDER BY id LIMIT ?",
                    [checkpoint.cursor ? Number(checkpoint.cursor) : 0, batchSize],
                );
                if (!targets.length) break;
                await this.rebuildTargets(targets.map((target: any) => safeTargetId(target.id)));
            }

            await this.dataSource.transaction(async (manager) => manager.query("DELETE FROM ranking_score"));
            await this.rankingService.rebuildCommonScores();
            await this.dataSource.transaction(async (manager) => {
                const [row] = await manager.query("SELECT report FROM statistics_maintenance WHERE id = 'main' FOR UPDATE");
                const report = readReport(row?.report);
                report.rebuild = {
                    ...(report.rebuild ?? {}),
                    complete: true,
                    completedAt: new Date().toISOString(),
                };
                await manager.query(
                    "UPDATE statistics_maintenance SET state = 'complete', operation = 'rebuild', report = ? WHERE id = 'main' AND state = 'running' AND operation = 'rebuild'",
                    [JSON.stringify(report)],
                );
            });
            return await this.status();
        } finally {
            if (lockAcquired) await runner.query("SELECT RELEASE_LOCK('statistics-maintenance')");
            await runner.release();
        }
    }

    async convertLegacyBatch(backupReference: string, resume = false, batchSize = 100) {
        this.validateMaintenanceRequest(backupReference, batchSize);
        const runner = this.dataSource.createQueryRunner();
        let lockAcquired = false;
        try {
            await runner.connect();
            await runner.query("SET SESSION innodb_lock_wait_timeout = 2");
            const [lock] = await runner.query("SELECT GET_LOCK('statistics-maintenance', 0) AS acquired");
            if (Number(lock.acquired) !== 1) throw new ConflictException("Another statistics maintenance operation is active");
            lockAcquired = true;
            const started = await this.beginConversion(runner, backupReference, resume);
            if (!started) return { hasMore: false, cursor: { phase: "complete" }, status: await this.status() };
        } finally {
            if (lockAcquired) await runner.query("SELECT RELEASE_LOCK('statistics-maintenance')");
            await runner.release();
        }

        const result = await this.dataSource.transaction(async (manager) => {
            const [checkpoint] = await manager.query(
                "SELECT `cursor`, report FROM statistics_maintenance WHERE id = 'main' AND operation = 'conversion' AND state = 'running' FOR UPDATE",
            );
            if (!checkpoint) throw new ConflictException("Statistics conversion is not running");
            const cursor = readCursor(checkpoint.cursor);
            const report = readReport(checkpoint.report);
            const conversion = report.conversion ??= { targetsCreated: 0, targetsPreserved: 0, importedLikes: 0, importedViews: 0, excludedReferences: 0, anonymizedActors: 0, queue: {}, invalidReferences: [] };
            let next = cursor;
            let hasMore = true;

            if (cursor.phase === "sources") {
                const type = sourceTypes[cursor.sourceIndex];
                if (!type) {
                    next = { phase: "likes", lastId: "" };
                } else {
                    const source = STATISTICS_SOURCE_TABLES[type];
                    const rows = await manager.query(
                        `SELECT \`${source.id}\` AS sourceId, statisticsTargetId FROM \`${source.table}\` WHERE \`${source.id}\` > ? ORDER BY \`${source.id}\` LIMIT ? FOR UPDATE`,
                        [cursor.lastId || "0", batchSize],
                    );
                    for (const row of rows) {
                        await this.ensureConvertedTarget(manager, type, row.sourceId, row.statisticsTargetId);
                        if (row.statisticsTargetId) conversion.targetsPreserved++;
                        else conversion.targetsCreated++;
                    }
                    next = rows.length === batchSize
                        ? { ...cursor, lastId: rows[rows.length - 1].sourceId }
                        : { phase: "sources", sourceIndex: cursor.sourceIndex + 1, lastId: "" };
                }
            } else if (cursor.phase === "likes" || cursor.phase === "views") {
                const table = cursor.phase === "likes" ? "user_like" : "user_view";
                if (!(await this.tableExists(manager, table))) {
                    next = cursor.phase === "likes" ? { phase: "views", lastId: "" } : { phase: "queue", state: queueStates[0], offset: 0 };
                } else {
                    const rows = await manager.query(
                        `SELECT *, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s.%f') AS legacyOccurredAt FROM \`${table}\` WHERE id > ? ORDER BY id LIMIT ? FOR UPDATE`,
                        [cursor.lastId || "0", batchSize],
                    );
                    for (const row of rows) {
                        const target = await this.resolveLegacyTarget(manager, row, table, report);
                        if (!target) { conversion.excludedReferences++; continue; }
                        let occurredAt: string;
                        try {
                            occurredAt = parseMySqlStatisticsInstant(row.legacyOccurredAt).mysql;
                        } catch {
                            this.addIssue(conversion, { table, rowId: String(row.id), reason: "missing_occurrence_time" });
                            conversion.excludedReferences++;
                            continue;
                        }
                        if (table === "user_like") {
                            const actor = await this.validActor(manager, row.profileUserId);
                            if (!actor) {
                                this.addIssue(conversion, { table, rowId: String(row.id), reason: "missing_actor" });
                                conversion.excludedReferences++;
                                continue;
                            }
                            const inserted = await this.convertLegacyLike(manager, row, target, actor, occurredAt);
                            if (inserted) conversion.importedLikes++;
                        } else {
                            const actorId = row.profileUserId == null ? null : await this.validActor(manager, row.profileUserId);
                            if (row.profileUserId != null && actorId == null) conversion.anonymizedActors++;
                            const inserted = await this.convertLegacyView(manager, `legacy:view:${row.id}`, target.targetId, actorId, occurredAt, "legacy-recorded");
                            if (inserted) conversion.importedViews++;
                        }
                    }
                    next = rows.length === batchSize
                        ? { ...cursor, lastId: String(rows[rows.length - 1].id) }
                        : cursor.phase === "likes"
                          ? { phase: "views", lastId: "" }
                          : { phase: "queue", state: queueStates[0], offset: 0 };
                }
            } else if (cursor.phase === "queue") {
                hasMore = false;
            } else if (cursor.phase === "ready" || cursor.phase === "complete") {
                hasMore = false;
            }

            await manager.query(
                "UPDATE statistics_maintenance SET `cursor` = ?, report = ? WHERE id = 'main' AND state = 'running' AND operation = 'conversion'",
                [JSON.stringify(next), JSON.stringify(report)],
            );
            return { hasMore, cursor: next };
        });
        return { ...result, status: await this.status() };
    }

    async captureLegacyQueueBatch(state: string, offset: number, jobs: LegacyQueueJob[], hasMore: boolean, batchSize = 100) {
        if (!queueStates.includes(state) || !Number.isInteger(offset) || offset < 0 || jobs.length > batchSize)
            throw new BadRequestException("Invalid statistics queue checkpoint");
        return this.dataSource.transaction(async (manager) => {
            const [checkpoint] = await manager.query(
                "SELECT `cursor`, report FROM statistics_maintenance WHERE id = 'main' AND operation = 'conversion' AND state = 'running' FOR UPDATE",
            );
            if (!checkpoint) throw new ConflictException("Statistics conversion is not running");
            const cursor = readCursor(checkpoint.cursor);
            if (cursor.phase !== "queue" || cursor.state !== state || cursor.offset !== offset)
                return { captured: 0, cursor };
            const report = readReport(checkpoint.report);
            const conversion = report.conversion ??= { queue: {}, invalidReferences: [] };
            const queueReport = conversion.queue ??= {};
            for (const key of ["seen", "importedViews", "initializedSources", "archivedLikeJobsSkipped", "ambiguousJobs", "invalidJobs", "completedJobsNotReplayed"])
                queueReport[key] ??= 0;
            for (const job of jobs) {
                queueReport.seen++;
                if (!job.id || job.id.length > 220) { queueReport.invalidJobs++; this.addIssue(conversion, { table: "statistics-queue", rowId: String(job.id ?? ""), reason: "invalid_job_identity" }); continue; }
                if (job.name === "like") { queueReport.archivedLikeJobsSkipped++; continue; }
                if (job.name !== "view" && job.name !== "create") { queueReport.invalidJobs++; continue; }
                if (state === "completed") { queueReport.completedJobsNotReplayed++; continue; }
                if (state === "active" || state === "failed" || state === "waiting-children") { queueReport.ambiguousJobs++; continue; }
                const type = job.data?.sourceType as StatisticsSourceType;
                const sourceId = job.data?.sourceId;
                if (!sourceTypes.includes(type) || !validLegacySourceId(type, sourceId)) {
                    queueReport.invalidJobs++;
                    this.addIssue(conversion, { table: "statistics-queue", rowId: job.id, reason: "invalid_source_identity" });
                    continue;
                }
                const source = STATISTICS_SOURCE_TABLES[type];
                const [sourceRow] = await manager.query(
                    `SELECT statisticsTargetId FROM \`${source.table}\` WHERE \`${source.id}\` = ? FOR UPDATE`,
                    [sourceId],
                );
                if (!sourceRow) {
                    queueReport.invalidJobs++;
                    this.addIssue(conversion, { table: "statistics-queue", rowId: job.id, sourceType: type, sourceId: String(sourceId), reason: "missing_source" });
                    continue;
                }
                let targetId = sourceRow.statisticsTargetId;
                if (!targetId) targetId = await this.ensureConvertedTarget(manager, type, sourceId, null);
                if (job.name === "create") { queueReport.initializedSources++; continue; }
                const occurredAt = new Date(job.timestamp);
                if (!Number.isFinite(occurredAt.getTime())) { queueReport.invalidJobs++; this.addIssue(conversion, { table: "statistics-queue", rowId: job.id, reason: "missing_enqueue_time" }); continue; }
                let actorId: string | null = null;
                if (job.data.userId !== undefined && job.data.userId !== null) {
                    actorId = await this.validActor(manager, job.data.userId);
                    if (!actorId) conversion.anonymizedActors++;
                }
                if (await this.convertLegacyView(manager, `legacy:view-job:${job.id}`, safeTargetId(targetId), actorId, occurredAt, "legacy-job"))
                    queueReport.importedViews++;
            }
            const nextOffset = offset + jobs.length;
            const stateDone = !hasMore;
            const stateIndex = queueStates.indexOf(state);
            const nextCursor: ConversionCursor = stateDone
                ? stateIndex + 1 < queueStates.length
                    ? { phase: "queue", state: queueStates[stateIndex + 1], offset: 0 }
                    : { phase: "ready" }
                : { phase: "queue", state, offset: nextOffset };
            await manager.query(
                "UPDATE statistics_maintenance SET `cursor` = ?, report = ? WHERE id = 'main' AND state = 'running' AND operation = 'conversion'",
                [JSON.stringify(nextCursor), JSON.stringify(report)],
            );
            return { captured: jobs.length, cursor: nextCursor };
        });
    }

    async finishConversion(backupReference: string) {
        await this.dataSource.transaction(async (manager) => {
            const [checkpoint] = await manager.query("SELECT state, operation, `cursor`, backupReference, report FROM statistics_maintenance WHERE id = 'main' FOR UPDATE");
            if (checkpoint?.state !== "running" || checkpoint.operation !== "conversion" || checkpoint.backupReference !== backupReference || readCursor(checkpoint.cursor).phase !== "ready")
                throw new ConflictException("Statistics conversion is incomplete or uses a different backup reference");
            const report = readReport(checkpoint.report);
            report.conversion = {
                ...(report.conversion ?? {}),
                counterCorrections: await this.compareLegacyCounters(manager),
                complete: true,
                completedAt: new Date().toISOString(),
            };
            await manager.query("UPDATE statistics_maintenance SET state = 'complete', `cursor` = ?, report = ? WHERE id = 'main'", [JSON.stringify({ phase: "complete" }), JSON.stringify(report)]);
        });
        return this.status();
    }

    async status() {
        const [row] = await this.dataSource.query(
            "SELECT id, operation, `cursor`, state, historyCompleteSince, backupReference, report, updatedAt FROM statistics_maintenance WHERE id = 'main'",
        );
        if (!row) return { prepared: false };
        return {
            id: row.id,
            operation: row.operation,
            cursor: row.cursor,
            state: row.state,
            historyCompleteSince: row.historyCompleteSince,
            backupReference: row.backupReference,
            report: row.report,
            updatedAt: row.updatedAt,
        };
    }

    private validateMaintenanceRequest(backupReference: string, batchSize: number) {
        if (!backupReference.trim() || backupReference.length > 255)
            throw new BadRequestException("A coordinated backup reference is required");
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500)
            throw new BadRequestException("Maintenance batch size must be from 1 to 500");
    }

    private async beginConversion(runner: QueryRunner, backupReference: string, resume: boolean): Promise<boolean> {
        await runner.startTransaction();
        try {
            const [checkpoint] = await runner.query("SELECT state, operation, `cursor`, backupReference, report FROM statistics_maintenance WHERE id = 'main' FOR UPDATE");
            if (!checkpoint) throw new Error("Run the statistics preparation migration first");
            const report = readReport(checkpoint.report);
            if (report.conversion?.complete) {
                if (checkpoint.backupReference !== backupReference)
                    throw new ConflictException("Statistics conversion was completed against a different backup reference");
                await runner.commitTransaction();
                return false;
            }
            if (checkpoint.state === "running") {
                if (!resume || checkpoint.operation !== "conversion")
                    throw new ConflictException("A statistics maintenance operation is already running; resume it explicitly");
                if (checkpoint.backupReference !== backupReference)
                    throw new ConflictException("Resume must use the original coordinated backup reference");
            } else {
                report.conversion = { targetsCreated: 0, targetsPreserved: 0, importedLikes: 0, importedViews: 0, excludedReferences: 0, anonymizedActors: 0, queue: {}, invalidReferences: [] };
                await runner.query(
                    "UPDATE statistics_maintenance SET operation = 'conversion', state = 'running', `cursor` = ?, backupReference = ?, historyCompleteSince = COALESCE(historyCompleteSince, CURRENT_TIMESTAMP(6)), report = ? WHERE id = 'main'",
                    [JSON.stringify({ phase: "sources", sourceIndex: 0, lastId: "" }), backupReference, JSON.stringify(report)],
                );
            }
            await runner.commitTransaction();
            return true;
        } catch (error: any) {
            await runner.rollbackTransaction();
            if (error?.errno === 1205 || error?.code === "ER_LOCK_WAIT_TIMEOUT")
                throw new ConflictException("An active statistics writer prevented offline conversion");
            throw error;
        }
    }

    private async beginRebuild(runner: QueryRunner, backupReference: string, resume: boolean) {
        await runner.query("SET SESSION innodb_lock_wait_timeout = 2");
        await runner.startTransaction();
        try {
            const [checkpoint] = await runner.query(
                "SELECT state, operation, `cursor`, backupReference, report FROM statistics_maintenance WHERE id = 'main' FOR UPDATE",
            );
            if (!checkpoint) throw new Error("Run the statistics preparation migration first");
            const report = readReport(checkpoint.report);
            if (!report.conversion?.complete)
                throw new ConflictException("Complete offline statistics conversion before rebuilding projections");
            if (checkpoint.backupReference !== backupReference)
                throw new ConflictException("Rebuild must use the coordinated backup reference from conversion");
            if (checkpoint.state === "running") {
                if (!resume || checkpoint.operation !== "rebuild")
                    throw new ConflictException("A statistics maintenance operation is already running; resume it explicitly");
            } else {
                report.rebuild = { complete: false, startedAt: new Date().toISOString(), processedTargets: 0 };
                await runner.query(
                    "UPDATE statistics_maintenance SET operation = 'rebuild', state = 'running', `cursor` = NULL, report = ? WHERE id = 'main'",
                    [JSON.stringify(report)],
                );
            }
            await runner.commitTransaction();
        } catch (error) {
            await runner.rollbackTransaction();
            if ((error as any)?.errno === 1205 || (error as any)?.code === "ER_LOCK_WAIT_TIMEOUT")
                throw new ConflictException("An active statistics writer prevented offline rebuild");
            throw error;
        }
    }

    private async tableExists(manager: EntityManager, table: string): Promise<boolean> {
        const [row] = await manager.query(
            "SELECT 1 AS found FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1",
            [table],
        );
        return Boolean(row);
    }

    private addIssue(conversion: Record<string, any>, issue: Record<string, string>) {
        const issues = conversion.invalidReferences ??= [];
        if (issues.length < 100) issues.push(issue);
        conversion.invalidReferenceCount = (conversion.invalidReferenceCount ?? 0) + 1;
    }

    private async ensureConvertedTarget(manager: EntityManager, type: StatisticsSourceType, sourceId: string | number, existingId: unknown): Promise<number> {
        let targetId = existingId == null ? 0 : safeTargetId(existingId);
        const source = STATISTICS_SOURCE_TABLES[type];
        const active = await this.sourceIsActive(manager, type, sourceId);
        if (targetId) {
            const [target] = await manager.query("SELECT sourceType FROM statistics_target WHERE id = ? FOR UPDATE", [targetId]);
            if (!target || target.sourceType !== type) throw new Error(`Statistics target source kind does not match ${type}`);
        } else {
            const result = await manager.query("INSERT INTO statistics_target (sourceType, isActive) VALUES (?, ?)", [type, active ? 1 : 0]);
            targetId = safeTargetId(result.insertId);
            const update = await manager.query(`UPDATE \`${source.table}\` SET statisticsTargetId = ?, updatedAt = updatedAt WHERE \`${source.id}\` = ? AND statisticsTargetId IS NULL`, [targetId, sourceId]);
            if (Number(update.affectedRows) !== 1) throw new Error("Statistics target link changed during offline conversion");
        }
        if (!active) await manager.query("UPDATE statistics_target SET isActive = 0 WHERE id = ?", [targetId]);
        await manager.query("INSERT IGNORE INTO metric_total (targetId, metricCode, metricValue) VALUES (?, 'likes_current', 0)", [targetId]);
        return targetId;
    }

    private async sourceIsActive(manager: EntityManager, type: StatisticsSourceType, sourceId: string | number): Promise<boolean> {
        let postId: string | null = null;
        if (type === StatisticsSourceType.POST) {
            const [post] = await manager.query("SELECT deletedAt FROM post WHERE id = ?", [sourceId]);
            return Boolean(post && post.deletedAt == null);
        }
        if (type === StatisticsSourceType.POST_COMMENT) {
            const [comment] = await manager.query("SELECT postId AS rootId FROM post_comment WHERE id = ?", [sourceId]);
            postId = comment?.rootId ?? null;
        } else if (type === StatisticsSourceType.ACTIVITY) {
            const [activity] = await manager.query("SELECT postId FROM activity WHERE id = ?", [sourceId]);
            postId = activity?.postId ?? null;
        } else if (type === StatisticsSourceType.ACTIVITY_COMMENT) {
            const [comment] = await manager.query("SELECT a.postId FROM activity_comment c JOIN activity a ON a.id = c.activityId WHERE c.id = ?", [sourceId]);
            postId = comment?.postId ?? null;
        }
        if (!postId) return true;
        const [post] = await manager.query("SELECT deletedAt FROM post WHERE id = ?", [postId]);
        return Boolean(post && post.deletedAt == null);
    }

    private async resolveLegacyTarget(manager: EntityManager, row: any, table: "user_like" | "user_view", report: Record<string, any>) {
        const present = legacyLinks.filter((link) => !link.type.endsWith("_comment") && row[link.column] != null);
        if (row.commentStatisticsId != null && await this.tableExists(manager, "comment_statistics")) {
            const [comments] = await manager.query("SELECT reviewCommentId, activityCommentId, postCommentId FROM comment_statistics WHERE id = ?", [row.commentStatisticsId]);
            present.push(...legacyLinks.filter((link) => link.type.endsWith("_comment") && comments?.[link.sourceColumn] != null));
        }
        if (present.length !== 1) {
            const conversion = report.conversion;
            this.addIssue(conversion, { table, rowId: String(row.id), reason: present.length ? "ambiguous_source" : "missing_source" });
            return null;
        }
        const link = present[0];
        if (!(await this.tableExists(manager, link.table))) {
            this.addIssue(report.conversion, { table, rowId: String(row.id), reason: "missing_legacy_statistics" });
            return null;
        }
        const [legacy] = await manager.query(`SELECT \`${link.sourceColumn}\` AS sourceId FROM \`${link.table}\` WHERE id = ?`, [row[link.column]]);
        if (!legacy || !validLegacySourceId(link.type, legacy.sourceId)) {
            this.addIssue(report.conversion, { table, rowId: String(row.id), reason: "invalid_source_identity" });
            return null;
        }
        const source = STATISTICS_SOURCE_TABLES[link.type];
        const [sourceRow] = legacy?.sourceId == null ? [] : await manager.query(`SELECT statisticsTargetId FROM \`${source.table}\` WHERE \`${source.id}\` = ? FOR UPDATE`, [legacy.sourceId]);
        if (!sourceRow) {
            this.addIssue(report.conversion, { table, rowId: String(row.id), sourceType: link.type, sourceId: String(legacy?.sourceId ?? ""), reason: "missing_source" });
            return null;
        }
        const targetId = await this.ensureConvertedTarget(manager, link.type, legacy.sourceId, sourceRow.statisticsTargetId);
        return { targetId, sourceType: link.type, sourceId: legacy.sourceId };
    }

    private async validActor(manager: EntityManager, value: unknown): Promise<string | null> {
        if (typeof value !== "string" || !isUUID(value)) return null;
        const [profile] = await manager.query("SELECT userId FROM profile WHERE userId = ?", [value]);
        return profile?.userId ?? null;
    }

    private async convertLegacyLike(manager: EntityManager, row: any, target: { targetId: number }, actorId: string, occurredAt: string): Promise<boolean> {
        const eventKey = `legacy:like:${row.id}`;
        const [existing] = await manager.query("SELECT targetId, actorUserId, eventKind FROM statistics_event WHERE eventKey = ?", [eventKey]);
        if (existing && (Number(existing.targetId) !== target.targetId || existing.actorUserId !== actorId || existing.eventKind !== "like.added"))
            throw new Error("Legacy like identity conflicts with an existing statistics fact");
        const [state] = await manager.query("SELECT firstLikedAt FROM engagement_state WHERE targetId = ? AND profileUserId = ? FOR UPDATE", [target.targetId, actorId]);
        const credit = state?.firstLikedAt ? 0 : 1;
        if (!existing) {
            await manager.query(
                "INSERT INTO statistics_event (eventKey, eventVersion, eventKind, targetId, actorUserId, occurredAt, provenance, firstLikeCredit, projectionState, nextAttemptAt) VALUES (?, 1, 'like.added', ?, ?, ?, 'legacy-recorded', ?, 'pending', CURRENT_TIMESTAMP(6))",
                [eventKey, target.targetId, actorId, occurredAt, credit],
            );
        }
        await manager.query(
            `INSERT INTO engagement_state (targetId, profileUserId, likedAt, firstLikedAt)
             VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE likedAt = COALESCE(likedAt, VALUES(likedAt)), firstLikedAt = COALESCE(firstLikedAt, VALUES(firstLikedAt))`,
            [target.targetId, actorId, occurredAt, occurredAt],
        );
        return !existing;
    }

    private async convertLegacyView(manager: EntityManager, eventKey: string, targetId: number, actorId: string | null, occurredAt: Date | string, provenance: "legacy-recorded" | "legacy-job"): Promise<boolean> {
        const [existing] = await manager.query("SELECT targetId, actorUserId, eventKind FROM statistics_event WHERE eventKey = ?", [eventKey]);
        if (existing && (Number(existing.targetId) !== targetId || (existing.actorUserId ?? null) !== actorId || existing.eventKind !== "view.recorded"))
            throw new Error("Legacy view identity conflicts with an existing statistics fact");
        if (!existing) await manager.query(
            "INSERT INTO statistics_event (eventKey, eventVersion, eventKind, targetId, actorUserId, occurredAt, provenance, projectionState, nextAttemptAt) VALUES (?, 1, 'view.recorded', ?, ?, ?, ?, 'pending', CURRENT_TIMESTAMP(6))",
            [eventKey, targetId, actorId, occurredAt, provenance],
        );
        if (actorId) await manager.query(
            `INSERT INTO engagement_state (targetId, profileUserId, lastViewedAt) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE lastViewedAt = GREATEST(COALESCE(lastViewedAt, '1000-01-01'), VALUES(lastViewedAt))`,
            [targetId, actorId, occurredAt],
        );
        return !existing;
    }

    private async compareLegacyCounters(manager: EntityManager) {
        const corrections: Array<Record<string, unknown>> = [];
        for (const link of legacyLinks) {
            if (!(await this.tableExists(manager, link.table))) continue;
            const source = STATISTICS_SOURCE_TABLES[link.type];
            const [row] = await manager.query(
                `SELECT COUNT(*) AS legacyRows,
                    SUM(s.viewsCount <> COALESCE(v.value, 0)) AS viewMismatchRows,
                    SUM(ABS(CAST(s.viewsCount AS SIGNED) - COALESCE(v.value, 0))) AS viewDifference,
                    SUM(s.likesCount <> COALESCE(l.value, 0)) AS likeMismatchRows,
                    SUM(ABS(CAST(s.likesCount AS SIGNED) - COALESCE(l.value, 0))) AS likeDifference,
                    SUM(src.\`${source.id}\` IS NULL) AS missingSources
                 FROM \`${link.table}\` s LEFT JOIN \`${source.table}\` src ON src.\`${source.id}\` = s.\`${link.sourceColumn}\`
                 LEFT JOIN (SELECT targetId, COUNT(*) AS value FROM statistics_event WHERE eventKind = 'view.recorded' GROUP BY targetId) v ON v.targetId = src.statisticsTargetId
                 LEFT JOIN (SELECT targetId, COUNT(*) AS value FROM engagement_state WHERE likedAt IS NOT NULL GROUP BY targetId) l ON l.targetId = src.statisticsTargetId
                 WHERE s.\`${link.sourceColumn}\` IS NOT NULL`,
            );
            if (Number(row.legacyRows)) corrections.push({
                sourceType: link.type,
                legacyRows: Number(row.legacyRows),
                viewMismatchRows: Number(row.viewMismatchRows ?? 0),
                viewDifference: Number(row.viewDifference ?? 0),
                likeMismatchRows: Number(row.likeMismatchRows ?? 0),
                likeDifference: Number(row.likeDifference ?? 0),
                missingSources: Number(row.missingSources ?? 0),
            });
        }
        return corrections;
    }

    private async rebuildTargets(targetIds: number[]) {
        await this.dataSource.transaction(async (manager) => {
            const [invalid] = await manager.query(
                "SELECT COUNT(*) AS count FROM statistics_event WHERE targetId IN (?) AND (eventVersion <> 1 OR eventKind NOT IN (?) OR provenance NOT IN (?))",
                [targetIds, allowedKinds, allowedProvenance],
            );
            if (Number(invalid.count)) throw new Error(`Unsupported retained fact for target batch ending ${targetIds[targetIds.length - 1]}`);
            await manager.query("DELETE FROM metric_total WHERE targetId IN (?)", [targetIds]);
            await manager.query("DELETE FROM metric_hour WHERE targetId IN (?)", [targetIds]);
            await manager.query(
                `INSERT INTO metric_total (targetId, metricCode, metricValue)
                SELECT t.id, codes.metricCode,
                    CASE codes.metricCode
                        WHEN 'likes_current' THEN COALESCE(s.activeLikes, 0)
                        WHEN 'views' THEN COALESCE(e.views, 0)
                        WHEN 'likes_added' THEN COALESCE(e.likesAdded, 0)
                        WHEN 'likes_removed' THEN COALESCE(e.likesRemoved, 0)
                        ELSE COALESCE(e.likeCredit, 0)
                    END
                FROM statistics_target t
                CROSS JOIN (SELECT 'likes_current' AS metricCode UNION ALL SELECT 'views' UNION ALL SELECT 'likes_added' UNION ALL SELECT 'likes_removed' UNION ALL SELECT 'like_credit') codes
                LEFT JOIN (SELECT targetId, COUNT(*) AS activeLikes FROM engagement_state WHERE targetId IN (?) AND likedAt IS NOT NULL GROUP BY targetId) s ON s.targetId = t.id
                LEFT JOIN (SELECT targetId,
                    SUM(eventKind = 'view.recorded') AS views,
                    SUM(eventKind = 'like.added') AS likesAdded,
                    SUM(eventKind = 'like.removed') AS likesRemoved,
                    SUM(eventKind = 'like.added' AND firstLikeCredit = 1) AS likeCredit
                    FROM statistics_event WHERE targetId IN (?) GROUP BY targetId) e ON e.targetId = t.id
                WHERE t.id IN (?)`,
                [targetIds, targetIds, targetIds],
            );
            await manager.query(
                `INSERT INTO metric_hour (targetId, metricCode, bucketStart, metricValue)
                SELECT targetId, metricCode, bucketStart, COUNT(*) FROM (
                    SELECT targetId,
                        CASE eventKind WHEN 'view.recorded' THEN 'views' WHEN 'like.added' THEN 'likes_added' ELSE 'likes_removed' END AS metricCode,
                        TIMESTAMP(DATE_FORMAT(occurredAt, '%Y-%m-%d %H:00:00')) AS bucketStart
                    FROM statistics_event WHERE targetId IN (?) AND eventKind IN ('view.recorded', 'like.added', 'like.removed')
                    UNION ALL
                    SELECT targetId, 'like_credit', TIMESTAMP(DATE_FORMAT(occurredAt, '%Y-%m-%d %H:00:00')) AS bucketStart
                    FROM statistics_event WHERE targetId IN (?) AND eventKind = 'like.added' AND firstLikeCredit = 1
                ) contributions GROUP BY targetId, metricCode, bucketStart`,
                [targetIds, targetIds],
            );
            await manager.query(
                "UPDATE statistics_event SET projectionState = 'done', attempts = 0, nextAttemptAt = CURRENT_TIMESTAMP(6), lastError = NULL WHERE targetId IN (?)",
                [targetIds],
            );
            await manager.query(
                "UPDATE statistics_maintenance SET `cursor` = ?, report = JSON_SET(COALESCE(report, JSON_OBJECT()), '$.rebuild.processedTargets', COALESCE(JSON_EXTRACT(report, '$.rebuild.processedTargets'), 0) + ?) WHERE id = 'main' AND operation = 'rebuild' AND state = 'running'",
                [String(targetIds[targetIds.length - 1]), targetIds.length],
            );
        });
    }
}
