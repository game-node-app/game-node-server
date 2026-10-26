import { Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { StatisticsEventKind } from "./entity/statistics-event.entity";
import {
    STATISTICS_PROJECTION_BATCH_SIZE,
    STATISTICS_PROJECTION_MAX_RETRIES,
} from "./statistics-projection.constants";

type DueEvent = {
    id: number;
    eventVersion: number;
    eventKind: StatisticsEventKind;
    targetId: number;
    occurredAt: Date;
    firstLikeCredit: number;
    attempts: number;
};

@Injectable()
export class StatisticsProjectionService {
    private readonly logger = new Logger(StatisticsProjectionService.name);

    constructor(private readonly dataSource: DataSource) {}

    async drain(limit = STATISTICS_PROJECTION_BATCH_SIZE): Promise<number> {
        if (!Number.isInteger(limit) || limit < 1 || limit > STATISTICS_PROJECTION_BATCH_SIZE)
            throw new Error(`Projection batch limit must be between 1 and ${STATISTICS_PROJECTION_BATCH_SIZE}`);
        let processed = 0;
        for (; processed < limit; processed++) {
            let event: DueEvent | undefined;
            try {
                const found = await this.dataSource.transaction(async (manager) => {
                    [event] = await manager.query(
                        `SELECT id, eventVersion, eventKind, targetId, occurredAt, firstLikeCredit, attempts
                        FROM statistics_event
                        WHERE projectionState = 'pending' AND nextAttemptAt <= CURRENT_TIMESTAMP(6)
                        ORDER BY nextAttemptAt, id LIMIT 1 FOR UPDATE SKIP LOCKED`,
                    );
                    if (!event) return false;
                    if (Number(event.eventVersion) !== 1)
                        throw new Error("unsupported event version");
                    const bucketStart = new Date(event.occurredAt);
                    bucketStart.setUTCMinutes(0, 0, 0);
                    const contributions: string[] = [];
                    switch (event.eventKind) {
                        case "view.recorded":
                            contributions.push("views");
                            break;
                        case "like.added":
                            contributions.push("likes_added");
                            if (Number(event.firstLikeCredit)) contributions.push("like_credit");
                            break;
                        case "like.removed":
                            contributions.push("likes_removed");
                            break;
                        default:
                            throw new Error("unsupported event kind");
                    }
                    for (const metricCode of contributions) {
                        await manager.query(
                            `INSERT INTO metric_total (targetId, metricCode, metricValue) VALUES (?, ?, 1)
                            ON DUPLICATE KEY UPDATE metricValue = metricValue + 1`,
                            [event.targetId, metricCode],
                        );
                        await manager.query(
                            `INSERT INTO metric_hour (targetId, metricCode, bucketStart, metricValue) VALUES (?, ?, ?, 1)
                            ON DUPLICATE KEY UPDATE metricValue = metricValue + 1`,
                            [event.targetId, metricCode, bucketStart],
                        );
                    }
                    await manager.query(
                        "UPDATE statistics_event SET projectionState = 'done', lastError = NULL WHERE id = ? AND projectionState = 'pending'",
                        [event.id],
                    );
                    return true;
                });
                if (!found) break;
            } catch (error) {
                if (!event) {
                    this.logger.warn("Statistics projection tick could not claim a fact");
                    break;
                }
                try {
                    await this.recordFailure(event, error);
                } catch {
                    this.logger.warn("Statistics projection failure checkpoint could not be saved");
                    break;
                }
            }
        }
        return processed;
    }

    private async recordFailure(event: DueEvent, error: unknown): Promise<void> {
        const attempts = Number(event.attempts) + 1;
        const delaySeconds = Math.min(300, 2 ** Math.min(attempts, 8));
        const terminal = attempts > STATISTICS_PROJECTION_MAX_RETRIES;
        const message =
            error instanceof Error
                ? `${error.name}: ${error.message.split("\n", 1)[0]}`
                : "Statistics projection failed";
        const boundedError = message.replace(/[\r\n\t]/g, " ").slice(0, 240);
        await this.dataSource.query(
            `UPDATE statistics_event SET attempts = ?,
                projectionState = IF(?, 'failed', 'pending'),
                nextAttemptAt = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? SECOND), lastError = ?
            WHERE id = ? AND projectionState = 'pending' AND attempts = ?`,
            [attempts, terminal ? 1 : 0, delaySeconds, boundedError, event.id, event.attempts],
        );
    }

    async rearm(eventId: number): Promise<boolean> {
        if (!Number.isSafeInteger(eventId) || eventId < 1)
            throw new Error("Statistics event id must be a positive safe integer");
        return this.dataSource.transaction(async (manager) => {
            const result = await manager.query(
                "UPDATE statistics_event SET projectionState = 'pending', attempts = 0, nextAttemptAt = CURRENT_TIMESTAMP(6), lastError = NULL WHERE id = ? AND projectionState = 'failed'",
                [eventId],
            );
            return Number(result.affectedRows) === 1;
        });
    }

    async diagnostics() {
        const [state] = await this.dataSource.query(
            `SELECT SUM(projectionState = 'pending') AS pendingCount,
                SUM(projectionState = 'failed') AS failedCount,
                MIN(CASE WHEN projectionState = 'pending' THEN recordedAt END) AS oldestPendingAt
            FROM statistics_event`,
        );
        const oldest = state.oldestPendingAt
            ? new Date(state.oldestPendingAt).getTime()
            : null;
        return {
            pendingCount: Number(state.pendingCount || 0),
            failedCount: Number(state.failedCount || 0),
            projectionLagSeconds: oldest === null ? 0 : Math.max(0, (Date.now() - oldest) / 1000),
        };
    }
}
