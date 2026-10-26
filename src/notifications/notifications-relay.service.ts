import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { DataSource, Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import {
    NOTIFICATIONS_JOB_RETENTION_COMPLETE,
    NOTIFICATIONS_JOB_RETENTION_FAIL,
    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
    NOTIFICATIONS_QUEUE_NAME,
    NOTIFICATIONS_RELAY_INTERVAL_MS,
    NOTIFICATIONS_RELAY_SCHEDULER_ID,
    NOTIFICATIONS_RELAY_TICK_JOB_NAME,
    OUTBOX_BASE_BACKOFF_MS,
    OUTBOX_DEFAULT_CLAIM_LIMIT,
    OUTBOX_DEFAULT_LEASE_MS,
    OUTBOX_MAX_ATTEMPTS,
    OUTBOX_MAX_BACKOFF_MS,
} from "./notifications.constants";

export interface OutboxProcessJobData {
    eventId: string;
    attemptToken: string;
}

@Injectable()
export class NotificationsRelayService implements OnModuleInit {
    private readonly logger = new Logger(NotificationsRelayService.name);
    private isTicking = false;

    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(NotificationOutbox)
        private readonly outboxRepo: Repository<NotificationOutbox>,
        @InjectQueue(NOTIFICATIONS_QUEUE_NAME)
        private readonly queue: Queue,
    ) {}

    async onModuleInit(): Promise<void> {
        try {
            await this.queue.upsertJobScheduler(
                NOTIFICATIONS_RELAY_SCHEDULER_ID,
                { every: NOTIFICATIONS_RELAY_INTERVAL_MS },
                {
                    name: NOTIFICATIONS_RELAY_TICK_JOB_NAME,
                    data: {},
                    opts: {
                        attempts: 1,
                        removeOnComplete: NOTIFICATIONS_JOB_RETENTION_COMPLETE,
                        removeOnFail: NOTIFICATIONS_JOB_RETENTION_FAIL,
                    },
                },
            );
        } catch (error) {
            this.logger.error("Unable to arm notification relay tick");
            throw error;
        }
    }

    async relayTick(): Promise<number> {
        if (this.isTicking) {
            return 0;
        }
        this.isTicking = true;
        try {
            const rows = await this.claimDueRows();
            if (rows.length > 0) {
                await this.publishClaimedRows(rows);
            }
            return rows.length;
        } catch {
            this.logger.error(
                "Notification relay tick failed; inspect bounded outbox diagnostics",
            );
            return 0;
        } finally {
            this.isTicking = false;
        }
    }

    async claimDueRows(
        limit = OUTBOX_DEFAULT_CLAIM_LIMIT,
        leaseMs = OUTBOX_DEFAULT_LEASE_MS,
    ): Promise<NotificationOutbox[]> {
        if (
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > OUTBOX_DEFAULT_CLAIM_LIMIT ||
            !Number.isInteger(leaseMs) ||
            leaseMs < 1000 ||
            leaseMs > OUTBOX_DEFAULT_LEASE_MS
        ) {
            throw new RangeError("Invalid outbox claim bounds");
        }
        return await this.dataSource.transaction(async (manager) => {
            const now = new Date();
            // MySQL 8.x: SELECT ... FOR UPDATE SKIP LOCKED
            const dueRows: NotificationOutbox[] = await manager.query(
                `SELECT * FROM notification_outbox
                 WHERE (state = 'pending' AND nextAttemptAt <= ?)
                    OR (state = 'processing' AND ownerExpiresAt <= ?)
                 ORDER BY nextAttemptAt ASC
                 LIMIT ?
                 FOR UPDATE SKIP LOCKED`,
                [now, now, limit],
            );

            if (!dueRows || dueRows.length === 0) {
                return [];
            }

            const claimedRows: NotificationOutbox[] = [];

            for (const row of dueRows) {
                if (
                    row.state === "processing" ||
                    row.attempts >= OUTBOX_MAX_ATTEMPTS
                ) {
                    const failed = row.attempts >= OUTBOX_MAX_ATTEMPTS;
                    await manager.update(
                        NotificationOutbox,
                        { id: row.id },
                        {
                            state: failed ? "failed" : "pending",
                            ownerToken: null,
                            ownerExpiresAt: null,
                            nextAttemptAt: new Date(
                                Date.now() +
                                    Math.min(
                                        OUTBOX_MAX_BACKOFF_MS,
                                        OUTBOX_BASE_BACKOFF_MS *
                                            2 ** Math.max(0, row.attempts - 1),
                                    ),
                            ),
                            lastError:
                                row.state === "processing"
                                    ? "owner_expired"
                                    : "attempts_exhausted",
                        },
                    );
                    continue;
                }
                const ownerToken = randomUUID();
                const ownerExpiresAt = new Date(Date.now() + leaseMs);

                await manager.query(
                    `UPDATE notification_outbox
                     SET state = 'processing',
                         ownerToken = ?,
                         ownerExpiresAt = ?,
                         attempts = attempts + 1,
                         updatedAt = NOW(6)
                     WHERE id = ?`,
                    [ownerToken, ownerExpiresAt, row.id],
                );

                claimedRows.push({
                    ...row,
                    state: "processing",
                    ownerToken,
                    ownerExpiresAt,
                    attempts: row.attempts + 1,
                });
            }

            return claimedRows;
        });
    }

    async publishClaimedRows(rows: NotificationOutbox[]): Promise<void> {
        for (const row of rows) {
            if (!row.ownerToken) continue;
            try {
                await this.queue.add(
                    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
                    {
                        eventId: row.id,
                        attemptToken: row.ownerToken,
                    } as OutboxProcessJobData,
                    {
                        jobId: `notification-${row.id}-${row.ownerToken}`,
                        attempts: 1, // one BullMQ transport attempt - outbox is the single retry authority
                        removeOnComplete: NOTIFICATIONS_JOB_RETENTION_COMPLETE,
                        removeOnFail: NOTIFICATIONS_JOB_RETENTION_FAIL,
                    },
                );
            } catch {
                await this.recordFailure(
                    row.id,
                    row.ownerToken,
                    "transport_unavailable",
                );
            }
        }
    }

    async recordSuccess(eventId: string, ownerToken: string): Promise<boolean> {
        const result = await this.outboxRepo.update(
            { id: eventId, ownerToken, state: "processing" },
            {
                state: "completed",
                completedAt: new Date(),
                ownerToken: null,
                ownerExpiresAt: null,
            },
        );
        return (result.affected ?? 0) > 0;
    }

    async recordSuppression(
        eventId: string,
        ownerToken: string,
        reason: string,
    ): Promise<boolean> {
        const result = await this.outboxRepo.update(
            { id: eventId, ownerToken, state: "processing" },
            {
                state: "suppressed",
                completedAt: new Date(),
                ownerToken: null,
                ownerExpiresAt: null,
                lastError: reason,
            },
        );
        return (result.affected ?? 0) > 0;
    }

    async recordFailure(
        eventId: string,
        ownerToken: string,
        error: Error | string,
        isPoison = false,
    ): Promise<void> {
        const errorMessage =
            typeof error === "string" &&
            ["transport_unavailable", "owner_expired"].includes(error)
                ? error
                : isPoison
                  ? "invalid_event"
                  : "delivery_failed";

        const row = await this.outboxRepo.findOne({
            where: { id: eventId, ownerToken, state: "processing" },
        });

        if (!row) {
            this.logger.warn("Ignoring failure from a stale outbox owner");
            return;
        }

        if (isPoison || row.attempts >= OUTBOX_MAX_ATTEMPTS) {
            await this.outboxRepo.update(
                { id: eventId, ownerToken, state: "processing" },
                {
                    state: "failed",
                    ownerToken: null,
                    ownerExpiresAt: null,
                    lastError: errorMessage.slice(0, 1000),
                },
            );
        } else {
            const delayMs = Math.min(
                OUTBOX_MAX_BACKOFF_MS,
                OUTBOX_BASE_BACKOFF_MS * Math.pow(2, row.attempts - 1),
            );
            const nextAttemptAt = new Date(Date.now() + delayMs);

            await this.outboxRepo.update(
                { id: eventId, ownerToken, state: "processing" },
                {
                    state: "pending",
                    ownerToken: null,
                    ownerExpiresAt: null,
                    nextAttemptAt,
                    lastError: errorMessage.slice(0, 1000),
                },
            );
        }
    }

    async rearmEvent(eventId: string): Promise<boolean> {
        const result = await this.outboxRepo.update(
            { id: eventId },
            {
                state: "pending",
                attempts: 0,
                ownerToken: null,
                ownerExpiresAt: null,
                nextAttemptAt: new Date(),
                lastError: null,
                completedAt: null,
            },
        );
        return (result.affected ?? 0) > 0;
    }

    async getDiagnostics() {
        const [row] = await this.dataSource.query(`SELECT
            SUM(state = 'pending') AS pendingCount, SUM(state = 'processing') AS processingCount,
            SUM(state = 'failed') AS failedCount, SUM(state = 'suppressed') AS suppressedCount,
            SUM(state = 'completed') AS completedCount, SUM(GREATEST(0, attempts - 1)) AS retryAttempts,
            MIN(CASE WHEN state IN ('pending', 'processing') THEN createdAt END) AS oldestPendingAt,
            AVG(CASE WHEN state = 'completed' THEN GREATEST(0, TIMESTAMPDIFF(MICROSECOND, createdAt, completedAt)) / 1000 END) AS averageCompletionLatencyMs,
            MAX(CASE WHEN state = 'completed' THEN GREATEST(0, TIMESTAMPDIFF(MICROSECOND, createdAt, completedAt)) / 1000 END) AS maximumCompletionLatencyMs
            FROM notification_outbox`);
        return {
            pendingCount: Number(row.pendingCount || 0),
            processingCount: Number(row.processingCount || 0),
            failedCount: Number(row.failedCount || 0),
            suppressedCount: Number(row.suppressedCount || 0),
            completedCount: Number(row.completedCount || 0),
            retryAttempts: Number(row.retryAttempts || 0),
            oldestPendingAgeMs: row.oldestPendingAt
                ? Math.max(
                      0,
                      Date.now() - new Date(row.oldestPendingAt).getTime(),
                  )
                : null,
            averageCompletionLatencyMs:
                row.averageCompletionLatencyMs == null
                    ? null
                    : Number(row.averageCompletionLatencyMs),
            maximumCompletionLatencyMs:
                row.maximumCompletionLatencyMs == null
                    ? null
                    : Number(row.maximumCompletionLatencyMs),
        };
    }
}
