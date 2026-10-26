import { EntityManager } from "typeorm";
import { ServiceUnavailableException } from "@nestjs/common";
import { StatisticsSourceType } from "./statistics.constants";

export const STATISTICS_SOURCE_TABLES: Record<StatisticsSourceType, { table: string; id: string }> = {
    [StatisticsSourceType.GAME]: { table: "game", id: "id" },
    [StatisticsSourceType.REVIEW]: { table: "review", id: "id" },
    [StatisticsSourceType.ACTIVITY]: { table: "activity", id: "id" },
    [StatisticsSourceType.POST]: { table: "post", id: "id" },
    [StatisticsSourceType.REVIEW_COMMENT]: { table: "review_comment", id: "id" },
    [StatisticsSourceType.ACTIVITY_COMMENT]: { table: "activity_comment", id: "id" },
    [StatisticsSourceType.POST_COMMENT]: { table: "post_comment", id: "id" },
};

function getTableName(manager: EntityManager, baseTable: string): string {
    const prefix = manager.connection.options.entityPrefix ?? "";
    return `\`${prefix}${baseTable}\``;
}

function requireTransaction(manager: EntityManager) {
    if (!manager.queryRunner?.isTransactionActive) {
        throw new Error("Statistics target initialization requires the source transaction");
    }
}

export async function assertStatisticsWritesAllowed(manager: EntityManager): Promise<void> {
    requireTransaction(manager);
    const maintenanceTable = getTableName(manager, "statistics_maintenance");
    try {
        const rows = await manager.query(`SELECT 1 FROM ${maintenanceTable} WHERE id = 'main' LIMIT 1`);
        if (!rows.length) return;
        const lockRows = await manager.query(
            `SELECT state FROM ${maintenanceTable} WHERE id = 'main' LOCK IN SHARE MODE`,
        );
        if (lockRows[0]?.state === "running")
            throw new ServiceUnavailableException("Statistics maintenance is active");
    } catch (err: any) {
        if (err?.code === "ER_NO_SUCH_TABLE") {
            return;
        }
        throw err;
    }
}

export async function createStatisticsTarget(
    manager: EntityManager,
    sourceType: StatisticsSourceType,
): Promise<number> {
    requireTransaction(manager);
    await assertStatisticsWritesAllowed(manager);
    const targetTable = getTableName(manager, "statistics_target");
    const metricTotalTable = getTableName(manager, "metric_total");
    const result = await manager.query(
        `INSERT INTO ${targetTable} (sourceType, isActive) VALUES (?, 1)`,
        [sourceType],
    );
    const id = Number(result.insertId);
    if (!Number.isSafeInteger(id) || id < 1) {
        throw new Error("Statistics target id is outside the safe numeric range");
    }
    await manager.query(
        `INSERT IGNORE INTO ${metricTotalTable} (targetId, metricCode, metricValue) VALUES (?, 'likes_current', 0)`,
        [id],
    );
    return id;
}

export async function linkStatisticsTarget(
    manager: EntityManager,
    sourceType: StatisticsSourceType,
    sourceId: number | string,
    targetId: number,
): Promise<void> {
    requireTransaction(manager);
    await assertStatisticsWritesAllowed(manager);
    const source = STATISTICS_SOURCE_TABLES[sourceType];
    if (!source) throw new Error(`Unsupported statistics source: ${sourceType}`);
    const targetTable = getTableName(manager, "statistics_target");
    const sourceTable = getTableName(manager, source.table);
    const [target] = await manager.query(`SELECT sourceType FROM ${targetTable} WHERE id = ? FOR UPDATE`, [targetId]);
    if (!target || target.sourceType !== sourceType)
        throw new Error("Statistics target source kind does not match its source");
    await manager.query(
        `UPDATE ${sourceTable} SET statisticsTargetId = ?, updatedAt = updatedAt WHERE \`${source.id}\` = ?`,
        [targetId, sourceId],
    );
}

/** Creates one target for an existing, locked source and preserves it on replay. */
export async function ensureStatisticsTarget(
    manager: EntityManager,
    sourceType: StatisticsSourceType,
    sourceId: number | string,
): Promise<number | null> {
    requireTransaction(manager);
    await assertStatisticsWritesAllowed(manager);
    const source = STATISTICS_SOURCE_TABLES[sourceType];
    if (!source) throw new Error(`Unsupported statistics source: ${sourceType}`);
    const sourceTable = getTableName(manager, source.table);
    const targetTable = getTableName(manager, "statistics_target");
    const metricTotalTable = getTableName(manager, "metric_total");
    const rows = await manager.query(
        `SELECT statisticsTargetId FROM ${sourceTable} WHERE \`${source.id}\` = ? FOR UPDATE`,
        [sourceId],
    );
    if (!rows[0]) return null;
    let targetId = rows[0].statisticsTargetId
        ? Number(rows[0].statisticsTargetId)
        : 0;
    if (!Number.isSafeInteger(targetId) || targetId < 0)
        throw new Error("Statistics target id is outside the safe numeric range");
    if (!targetId) {
        targetId = await createStatisticsTarget(manager, sourceType);
        await linkStatisticsTarget(manager, sourceType, sourceId, targetId);
    } else {
        const targetRows = await manager.query(
            `SELECT sourceType FROM ${targetTable} WHERE id = ? FOR UPDATE`,
            [targetId],
        );
        if (!targetRows[0] || targetRows[0].sourceType !== sourceType) {
            throw new Error("Statistics target source kind does not match its source");
        }
        await manager.query(
            `INSERT IGNORE INTO ${metricTotalTable} (targetId, metricCode, metricValue) VALUES (?, 'likes_current', 0)`,
            [targetId],
        );
    }
    return targetId;
}

export async function deactivateStatisticsTargets(
    manager: EntityManager,
    sourceType: StatisticsSourceType,
    sourceIds: Array<number | string>,
): Promise<void> {
    if (sourceIds.length === 0) return;
    requireTransaction(manager);
    await assertStatisticsWritesAllowed(manager);
    const source = STATISTICS_SOURCE_TABLES[sourceType];
    if (!source) throw new Error(`Unsupported statistics source: ${sourceType}`);
    const sourceTable = getTableName(manager, source.table);
    const targetTable = getTableName(manager, "statistics_target");
    const targets = await manager.query(
        `SELECT statisticsTargetId FROM ${sourceTable} WHERE \`${source.id}\` IN (?)`,
        [sourceIds],
    );
    const ids = targets
        .map((row: any) => Number(row.statisticsTargetId))
        .filter((id: number) => Number.isSafeInteger(id) && id > 0);
    if (ids.length)
        await manager.query(
            `UPDATE ${targetTable} SET isActive = 0 WHERE id IN (?)`,
            [ids],
        );
}

export async function deactivateStatisticsSource(
    manager: EntityManager,
    sourceType: StatisticsSourceType,
    sourceId: number | string,
): Promise<void> {
    requireTransaction(manager);
    await assertStatisticsWritesAllowed(manager);
    const source = STATISTICS_SOURCE_TABLES[sourceType];
    if (!source) throw new Error(`Unsupported statistics source: ${sourceType}`);
    const sourceTable = getTableName(manager, source.table);
    const targetTable = getTableName(manager, "statistics_target");
    const rows = await manager.query(
        `SELECT statisticsTargetId FROM ${sourceTable} WHERE \`${source.id}\` = ?${sourceType.endsWith("_comment") ? " OR childOfId = ?" : ""} ORDER BY \`${source.id}\` FOR UPDATE`,
        sourceType.endsWith("_comment") ? [sourceId, sourceId] : [sourceId],
    );
    const targetIds = rows.map((row: any) => row.statisticsTargetId).filter(Boolean);
    if (targetIds.length)
        await manager.query(
            `UPDATE ${targetTable} SET isActive = 0 WHERE id IN (?)`,
            [targetIds],
        );
}

export async function deactivateStatisticsContent(
    manager: EntityManager,
    contentType: "post" | "review" | "activity",
    contentId: string,
): Promise<void> {
    const commentTable = getTableName(manager, `${contentType}_comment`);
    const activityTable = getTableName(manager, "activity");
    await deactivateStatisticsSource(manager, contentType as StatisticsSourceType, contentId);
    const comments = await manager.query(
        `SELECT id FROM ${commentTable} WHERE \`${contentType}Id\` = ? FOR UPDATE`,
        [contentId],
    );
    const commentType = `${contentType}_comment` as StatisticsSourceType;
    for (const comment of comments)
        await deactivateStatisticsSource(manager, commentType, comment.id);
    if (contentType === "activity") return;
    const activities = await manager.query(
        `SELECT id FROM ${activityTable} WHERE \`${contentType}Id\` = ? FOR UPDATE`,
        [contentId],
    );
    for (const activity of activities)
        await deactivateStatisticsContent(manager, "activity", activity.id);
}

/** Removes an actor's current state in bounded batches, without synthesizing unlike facts. */
export async function cleanupStatisticsProfile(
    manager: EntityManager,
    userId: string,
): Promise<void> {
    requireTransaction(manager);
    await assertStatisticsWritesAllowed(manager);
    const stateTable = getTableName(manager, "engagement_state");
    const metricTotalTable = getTableName(manager, "metric_total");
    const eventTable = getTableName(manager, "statistics_event");
    const batchSize = 500;
    for (const sourceType of Object.values(StatisticsSourceType).filter((type) => type !== StatisticsSourceType.GAME)) {
        const sourceTable = getTableName(manager, STATISTICS_SOURCE_TABLES[sourceType].table);
        let cursor = "";
        while (true) {
            const sources = await manager.query(
                `SELECT id FROM ${sourceTable} WHERE profileUserId = ? AND id > ? ORDER BY id LIMIT ? FOR UPDATE`,
                [userId, cursor, batchSize],
            );
            if (!sources.length) break;
            for (const source of sources) {
                if (sourceType.endsWith("_comment"))
                    await deactivateStatisticsSource(manager, sourceType, source.id);
                else
                    await deactivateStatisticsContent(manager, sourceType as "post" | "review" | "activity", source.id);
            }
            cursor = sources[sources.length - 1].id;
        }
    }
    while (true) {
        const states = await manager.query(
            `SELECT targetId, likedAt FROM ${stateTable} WHERE profileUserId = ? ORDER BY targetId LIMIT ? FOR UPDATE`,
            [userId, batchSize],
        );
        if (!states.length) break;
        const likedByTarget = new Map<number, number>();
        for (const state of states) {
            if (state.likedAt) {
                const targetId = Number(state.targetId);
                likedByTarget.set(targetId, (likedByTarget.get(targetId) ?? 0) + 1);
            }
        }
        for (const [targetId, count] of likedByTarget) {
            const result = await manager.query(
                `UPDATE ${metricTotalTable} SET metricValue = metricValue - ?
                WHERE targetId = ? AND metricCode = 'likes_current' AND metricValue >= ?`,
                [count, targetId, count],
            );
            if (Number(result.affectedRows) !== 1)
                throw new Error("Active-like gauge is inconsistent with engagement state");
        }
        await manager.query(
            `DELETE FROM ${stateTable} WHERE profileUserId = ? AND targetId IN (?)`,
            [userId, states.map((state: any) => state.targetId)],
        );
    }
    while (true) {
        const result = await manager.query(
            `UPDATE ${eventTable} SET actorUserId = NULL WHERE actorUserId = ? ORDER BY id LIMIT ?`,
            [userId, batchSize],
        );
        if (!Number(result.affectedRows)) break;
    }
}
