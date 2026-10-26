import { Injectable } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Queue, JobType } from "bullmq";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { appendNotificationIntent } from "./notifications-outbox.service";
import {
    lockNotificationRoot,
    lockNotificationComment,
    NotificationRootType,
} from "./notifications-lifecycle.service";
import {
    extractSafePlainText,
    materializeNotificationTarget,
} from "./notifications-projector.service";

export interface CutoverConversionResult {
    convertedCount: number;
    excludedCount: number;
    exclusions: Array<{ id: number; reason: string }>;
    hasMore: boolean;
    lastId: number;
}

export async function assertNotificationCutoverComplete(
    manager: EntityManager,
) {
    const exists = await manager.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'notification'",
    );
    if (!exists.length) return;
    const states = await manager.query(
        "SELECT * FROM notification_cutover_state WHERE id IN ('legacy', 'importer', 'queue:notifications-queue', 'queue:statistics-queue')",
    );
    if (states.length !== 4 || states.some((row: any) => !row.completed))
        throw new Error(
            "Notification cutover is incomplete: stop ingress/workers, back up MySQL/Redis, then run notifications:cutover inventory, convert and verify",
        );
    const legacy = states.find((row: any) => row.id === "legacy");
    const [total] = await manager.query(
        "SELECT COUNT(*) AS total, COALESCE(MAX(id), 0) AS lastId FROM notification",
    );
    if (
        Number(total.total) !== legacy.convertedCount + legacy.excludedCount ||
        Number(total.lastId) > legacy.lastId
    )
        throw new Error(
            "Legacy notification counts do not match the conversion checkpoint",
        );
    const [represented] =
        await manager.query(`SELECT COUNT(*) AS total FROM notification n
        LEFT JOIN notification_event e ON e.eventId = CONCAT('legacy-notification-', n.id) AND e.recipientUserId = n.targetProfileUserId
        LEFT JOIN notification_cutover_exclusion x ON x.legacyId = n.id
        WHERE (e.id IS NOT NULL AND x.legacyId IS NULL) OR (e.id IS NULL AND x.legacyId IS NOT NULL)`);
    if (Number(represented.total) !== Number(total.total))
        throw new Error(
            "Each legacy row must have exactly one durable contribution or exclusion",
        );
    const pending = await manager.query(
        "SELECT id FROM importer_watch_notification WHERE pendingDelivery = 1 LIMIT 1",
    );
    if (pending.length)
        throw new Error("Committed importer results still need transfer");
}

@Injectable()
export class NotificationsCutoverService {
    constructor(private readonly dataSource: DataSource) {}

    private bound(batchSize: number) {
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
            throw new RangeError("Cutover batches must contain 1-100 records");
    }

    private async checkpoint(manager: EntityManager, id: string) {
        await manager.query(
            "INSERT IGNORE INTO notification_cutover_state (id) VALUES (?)",
            [id],
        );
        const rows = await manager.query(
            "SELECT * FROM notification_cutover_state WHERE id = ? FOR UPDATE",
            [id],
        );
        return rows[0];
    }

    async transferPendingImporterResults(batchSize = 100): Promise<number> {
        this.bound(batchSize);
        return this.dataSource.transaction(async (manager) => {
            await this.checkpoint(manager, "importer");
            if (
                !(
                    await manager.query(
                        "SHOW COLUMNS FROM importer_watch_notification LIKE 'pendingDelivery'",
                    )
                ).length
            ) {
                await manager.query(
                    "UPDATE notification_cutover_state SET completed = 1 WHERE id = 'importer'",
                );
                return 0;
            }
            const rows = await manager.query(
                "SELECT * FROM importer_watch_notification WHERE pendingDelivery = 1 ORDER BY id LIMIT ? FOR UPDATE",
                [batchSize],
            );
            for (const row of rows) {
                const payload = await this.importPayload(manager, row);
                const id = `importer-result-${row.id}`;
                const existing = await manager.query(
                    "SELECT id FROM notification_outbox WHERE id = ?",
                    [id],
                );
                if (!existing.length)
                    await appendNotificationIntent(manager, {
                        id,
                        eventType: "import.discovery-completed",
                        eventVersion: 1,
                        recipientUserId: row.libraryUserId,
                        actorUserId: null,
                        payload,
                    });
                await manager.query(
                    "UPDATE importer_watch_notification SET pendingDelivery = 0 WHERE id = ?",
                    [row.id],
                );
            }
            const remaining = await manager.query(
                "SELECT id FROM importer_watch_notification WHERE pendingDelivery = 1 LIMIT 1",
            );
            await manager.query(
                "UPDATE notification_cutover_state SET convertedCount = convertedCount + ?, completed = ? WHERE id = 'importer'",
                [rows.length, remaining.length ? 0 : 1],
            );
            return rows.length;
        });
    }

    private async importPayload(manager: EntityManager, row: any) {
        const [counts] = await manager.query(
            "SELECT COUNT(*) AS total FROM importer_watch_notification_games_game_external_game WHERE importerWatchNotificationId = ?",
            [row.id],
        );
        const games = await manager.query(
            `SELECT e.gameId AS id, g.name AS title FROM importer_watch_notification_games_game_external_game m
            JOIN game_external_game e ON e.id = m.gameExternalGameId LEFT JOIN game g ON g.id = e.gameId
            WHERE m.importerWatchNotificationId = ? AND e.gameId IS NOT NULL ORDER BY e.id LIMIT 3`,
            [row.id],
        );
        return {
            discoveryResultId: row.id,
            provider: row.source,
            gameCount: Number(counts.total),
            importedCount: Number(row.autoImportedCount),
            skippedCount: Number(row.autoImportSkippedCount),
            failedCount: Number(row.autoImportFailedCount),
            gameSample: games.map((game: any) => ({
                id: Number(game.id),
                title: extractSafePlainText(game.title, "Game").slice(0, 100),
            })),
        };
    }

    async convertLegacyNotifications(
        batchSize = 100,
    ): Promise<CutoverConversionResult> {
        this.bound(batchSize);
        return this.dataSource.transaction(async (manager) => {
            const state = await this.checkpoint(manager, "legacy");
            if (
                !(
                    await manager.query(
                        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'notification'",
                    )
                ).length
            ) {
                await manager.query(
                    "UPDATE notification_cutover_state SET completed = 1 WHERE id = 'legacy'",
                );
                return {
                    convertedCount: 0,
                    excludedCount: 0,
                    exclusions: [],
                    hasMore: false,
                    lastId: state.lastId,
                };
            }
            const rows = await manager.query(
                "SELECT * FROM notification WHERE id > ? ORDER BY id LIMIT ?",
                [state.lastId, batchSize],
            );
            const result: CutoverConversionResult = {
                convertedCount: 0,
                excludedCount: 0,
                exclusions: [],
                hasMore: false,
                lastId: state.lastId,
            };
            for (const row of rows) {
                result.lastId = row.id;
                const resolved = await this.resolveLegacy(manager, row);
                if (typeof resolved === "string") {
                    await manager.query(
                        "INSERT INTO notification_cutover_exclusion (legacyId, reason) VALUES (?, ?) ON DUPLICATE KEY UPDATE reason = VALUES(reason)",
                        [row.id, resolved],
                    );
                    result.excludedCount++;
                    result.exclusions.push({ id: row.id, reason: resolved });
                } else {
                    await this.contribute(manager, row, resolved);
                    result.convertedCount++;
                }
            }
            result.hasMore =
                (
                    await manager.query(
                        "SELECT id FROM notification WHERE id > ? LIMIT 1",
                        [result.lastId],
                    )
                ).length > 0;
            await manager.query(
                `UPDATE notification_cutover_state SET lastId = ?, convertedCount = convertedCount + ?,
                excludedCount = excludedCount + ?, completed = ? WHERE id = 'legacy'`,
                [
                    result.lastId,
                    result.convertedCount,
                    result.excludedCount,
                    result.hasMore ? 0 : 1,
                ],
            );
            return result;
        });
    }

    private async resolveLegacy(
        manager: EntityManager,
        row: any,
    ): Promise<any | string> {
        if (!row.targetProfileUserId) return "unassignable_global";
        const recipient = row.targetProfileUserId;
        if (
            !(
                await manager.query(
                    "SELECT userId FROM profile WHERE userId = ?",
                    [recipient],
                )
            ).length
        )
            return "recipient_removed";
        const category = String(row.category).toLowerCase(),
            sourceType = String(row.sourceType).toLowerCase();
        const base = {
            recipientUserId: recipient,
            actorUserId: row.profileUserId || null,
        };
        if (base.actorUserId === recipient) return "self_notification";
        if (sourceType === "importer") {
            const results = await manager.query(
                "SELECT * FROM importer_watch_notification WHERE id = ?",
                [row.importerNotificationId],
            );
            if (!results[0]) return "source_not_found";
            if (results[0].libraryUserId !== recipient)
                return "forged_recipient";
            const payload = await this.importPayload(manager, results[0]);
            return {
                ...base,
                actorUserId: null,
                type: "import.discovery-completed",
                subjectType: "importer",
                subjectId: String(results[0].id),
                rootType: "importer",
                rootId: String(results[0].id),
                preview: payload,
                target: {
                    type: "importer",
                    id: String(results[0].id),
                    provider: payload.provider,
                },
            };
        }
        if (sourceType === "report") {
            const reports = await manager.query(
                "SELECT targetProfileUserId, isClosed, closeHandleAction FROM report WHERE id = ?",
                [row.reportId],
            );
            const report = reports[0];
            if (!report?.isClosed) return "source_not_found";
            if (report.targetProfileUserId !== recipient)
                return "forged_recipient";
            const action = (
                { alert: "alert", suspend: "suspension", ban: "ban" } as Record<
                    string,
                    string
                >
            )[report.closeHandleAction];
            if (!action) return "unsupported_moderation";
            return {
                ...base,
                actorUserId: null,
                type: "moderation.applied",
                subjectType: "moderation",
                subjectId: String(row.reportId),
                rootType: "moderation",
                rootId: String(row.reportId),
                preview: { text: `Moderation notice: ${action}`, action },
                target: { type: "profile", id: recipient },
            };
        }
        if (sourceType === "profile" && category === "follow") {
            if (!base.actorUserId) return "missing_actor";
            return {
                ...base,
                type: "profile.followed",
                subjectType: "profile",
                subjectId: recipient,
                rootType: "profile",
                rootId: recipient,
                preview: { text: "Started following you" },
                target: { type: "profile", id: base.actorUserId },
            };
        }
        if (!["like", "comment"].includes(category)) return "unknown_category";
        let rootType: NotificationRootType | undefined,
            rootId: string | undefined,
            commentId: string | undefined;
        for (const type of ["post", "review", "activity"] as const) {
            if (row[`${type}CommentId`]) {
                commentId = row[`${type}CommentId`];
                const comments = await manager.query(
                    `SELECT ${type}Id AS rootId FROM ${type}_comment WHERE id = ?`,
                    [commentId],
                );
                if (!comments[0]) return "source_not_found";
                rootType = type;
                rootId = comments[0].rootId;
                break;
            }
            if (row[`${type}Id`]) {
                rootType = type;
                rootId = row[`${type}Id`];
                break;
            }
        }
        if (!rootType || !rootId) return "source_not_found";
        const root = await lockNotificationRoot(manager, rootType, rootId);
        if (!root) return "source_not_found";
        const comment = commentId
            ? await lockNotificationComment(
                  manager,
                  rootType,
                  rootId,
                  commentId,
              )
            : null;
        if (commentId && !comment) return "source_not_found";
        if ((comment?.profileUserId || root.profileUserId) !== recipient)
            return "forged_recipient";
        const isReply = category === "comment" && Boolean(commentId);
        const type =
            category === "like"
                ? "content.liked"
                : isReply
                  ? "comment.replied"
                  : "comment.created";
        const subjectType = commentId ? "comment" : rootType,
            subjectId = commentId || rootId;
        // Legacy comment references identify the root/parent, never the unknown trigger.
        const target = await materializeNotificationTarget(
            manager,
            rootType,
            rootId,
            root,
            category === "like" ? commentId : undefined,
        );
        return {
            ...base,
            type,
            subjectType,
            subjectId,
            rootType,
            rootId,
            target,
            preview: {
                text:
                    category === "like"
                        ? `Liked your ${subjectType}`
                        : isReply
                          ? "Replied to your comment"
                          : "Shared a comment",
            },
        };
    }

    private async contribute(
        manager: EntityManager,
        legacy: any,
        resolved: any,
    ) {
        const {
            recipientUserId,
            actorUserId,
            type,
            subjectType,
            subjectId,
            rootType,
            rootId,
            preview,
            target,
        } = resolved;
        const eventId = `legacy-notification-${legacy.id}`,
            occurredAt = new Date(legacy.createdAt);
        const grouped = [
            "content.liked",
            "comment.created",
            "comment.replied",
        ].includes(type);
        const groupKey = grouped
            ? `${recipientUserId}:${type}:${subjectType}:${subjectId}:${occurredAt.toISOString().slice(0, 10)}`
            : `${recipientUserId}:${type}:${eventId}`;
        if (
            await manager.existsBy(NotificationEvent, {
                eventId,
                recipientUserId,
            })
        )
            return;
        await manager
            .createQueryBuilder()
            .insert()
            .into(NotificationInbox)
            .values({
                recipientUserId,
                groupKey,
                type,
                subjectType,
                subjectId,
                rootType,
                rootId,
                actorIds: [],
                eventCount: 0,
                actorCount: 0,
                version: 0,
                readVersion: 0,
                lastEventAt: occurredAt,
                isVisible: true,
                isRedacted: false,
            })
            .orUpdate(["groupKey"])
            .updateEntity(false)
            .execute();
        const group = await manager.findOneOrFail(NotificationInbox, {
            where: { recipientUserId, groupKey },
            lock: { mode: "pessimistic_write" },
        });
        const prior = actorUserId
            ? await manager.query(
                  "SELECT id FROM notification_event WHERE recipientUserId = ? AND groupKey = ? AND actorUserId = ? LIMIT 1 FOR UPDATE",
                  [recipientUserId, groupKey, actorUserId],
              )
            : [];
        const latest = (
            await manager.query(
                "SELECT eventId, occurredAt FROM notification_event WHERE recipientUserId = ? AND groupKey = ? ORDER BY occurredAt DESC, eventId DESC LIMIT 1 FOR UPDATE",
                [recipientUserId, groupKey],
            )
        )[0];
        const newer =
            !latest ||
            occurredAt.getTime() > new Date(latest.occurredAt).getTime() ||
            (occurredAt.getTime() === new Date(latest.occurredAt).getTime() &&
                eventId > latest.eventId);
        await manager.save(
            NotificationEvent,
            manager.create(NotificationEvent, {
                eventId,
                recipientUserId,
                groupKey,
                eventType: type,
                actorUserId,
                subjectType,
                subjectId,
                rootType,
                rootId,
                preview,
                target,
                occurredAt,
                triggerCommentId: null,
                createdAt: occurredAt,
            }),
        );
        const actors = await manager.query(
            "SELECT actorUserId FROM notification_event WHERE recipientUserId = ? AND groupKey = ? AND actorUserId IS NOT NULL GROUP BY actorUserId ORDER BY MAX(occurredAt) DESC, MAX(eventId) DESC LIMIT 3 FOR UPDATE",
            [recipientUserId, groupKey],
        );
        const version = group.version + 1;
        await manager.save(NotificationInbox, {
            ...group,
            version,
            eventCount: group.eventCount + 1,
            readVersion:
                legacy.isViewed && group.readVersion === group.version
                    ? version
                    : 0,
            actorCount:
                group.actorCount + (actorUserId && !prior.length ? 1 : 0),
            actorIds: actors.map((row: any) => row.actorUserId),
            lastEventAt: newer ? occurredAt : group.lastEventAt,
            preview: newer ? preview : group.preview,
            target: newer ? target : group.target,
            triggerCommentId: newer ? null : group.triggerCommentId,
        });
    }

    async captureLegacyQueue(
        queue: Queue,
        batchSize = 100,
    ): Promise<{ captured: number; hasMore: boolean }> {
        this.bound(batchSize);
        if (!["notifications-queue", "statistics-queue"].includes(queue.name))
            throw new Error("Unsupported cutover queue");
        if (!(await queue.isPaused()))
            throw new Error(
                "Pause ingress and the queue and stop old workers before inventory",
            );
        const states: JobType[] = [
            "wait",
            "paused",
            "delayed",
            "failed",
            "active",
            "waiting-children",
        ];
        let captured = 0,
            hasMore = false;
        for (const state of states) {
            const id = `queue:${queue.name}:${state}`;
            const [checkpoint] = await this.dataSource.query(
                "SELECT lastId, completed FROM notification_cutover_state WHERE id = ?",
                [id],
            );
            if (checkpoint?.completed) continue;
            const offset = Number(checkpoint?.lastId || 0);
            const jobs = await queue.getJobs(
                [state],
                offset,
                offset + batchSize - 1,
                true,
            );
            await this.dataSource.transaction(async (manager) => {
                const current = await this.checkpoint(manager, id);
                if (current.lastId !== offset || current.completed) return;
                let archived = 0;
                for (const job of jobs) {
                    if (
                        (queue.name === "notifications-queue" &&
                            job.name !== "notifications-register") ||
                        (queue.name === "statistics-queue" &&
                            job.name !== "like")
                    )
                        continue;
                    if (!job.id)
                        throw new Error(
                            "Cannot inventory a job without identity",
                        );
                    const insert = await manager.query(
                        `INSERT IGNORE INTO notification_cutover_job (queueName, jobId, jobName, state, payload) VALUES (?, ?, ?, ?, ?)`,
                        [
                            queue.name,
                            job.id,
                            job.name,
                            state,
                            JSON.stringify(job.data),
                        ],
                    );
                    archived += insert.affectedRows;
                }
                captured += archived;
                await manager.query(
                    "UPDATE notification_cutover_state SET lastId = ?, convertedCount = convertedCount + ?, completed = ? WHERE id = ?",
                    [
                        offset + jobs.length,
                        archived,
                        jobs.length < batchSize ? 1 : 0,
                        id,
                    ],
                );
            });
            hasMore ||= jobs.length === batchSize;
        }
        if (!hasMore) {
            await this.dataSource.query(
                "INSERT INTO notification_cutover_state (id, completed) VALUES (?, 1) ON DUPLICATE KEY UPDATE completed = 1",
                [`queue:${queue.name}`],
            );
        }
        return { captured, hasMore };
    }

    async verify(backupReference: string) {
        if (!backupReference.trim() || backupReference.length > 255)
            throw new Error(
                "Supply the coordinated MySQL/Redis backup reference",
            );
        await this.dataSource.transaction(async (manager) => {
            await assertNotificationCutoverComplete(manager);
            await manager.query(
                `INSERT INTO notification_cutover_state (id, completed, backupReference) VALUES ('maintenance', 1, ?)
                ON DUPLICATE KEY UPDATE completed = 1, backupReference = VALUES(backupReference)`,
                [backupReference],
            );
        });
        return { verified: true };
    }
}
