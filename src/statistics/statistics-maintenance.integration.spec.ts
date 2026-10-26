import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { NotificationEvent } from "../notifications/entity/notification-event.entity";
import { NotificationInbox } from "../notifications/entity/notification-inbox.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { CreateNotificationCutoverLedger1792960197566 } from "../migrations/1792960197566-CreateNotificationCutoverLedger";
import { StatisticsEvent } from "./entity/statistics-event.entity";
import { StatisticsProjectionService } from "./statistics-projection.service";
import { StatisticsSourceType } from "./statistics.constants";
import { StatisticsMaintenanceService } from "./statistics-maintenance.service";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { StatisticsService } from "./statistics.service";
import { ensureStatisticsTarget } from "./statistics-target.repository";

describe("statistics maintenance rebuild", () => {
    let dataSource: DataSource;
    let maintenance: StatisticsMaintenanceService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        maintenance = new StatisticsMaintenanceService(dataSource, new StatisticsRankingService(dataSource));
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it("resumes an interrupted target atomically and preserves notification storage", async () => {
        await dataSource.query("DELETE FROM statistics_event WHERE eventKind = 'unknown.kind'");
        await dataSource.query(
            `INSERT INTO statistics_maintenance (id, operation, state, historyCompleteSince, backupReference, report)
            VALUES ('main', 'conversion', 'complete', NOW(6), 'test-backup', '{"conversion":{"complete":true}}')
            ON DUPLICATE KEY UPDATE operation = 'conversion', state = 'complete', \`cursor\` = NULL, historyCompleteSince = NOW(6), backupReference = 'test-backup', report = '{"conversion":{"complete":true}}'`,
        );
        const migrationRunner = dataSource.createQueryRunner();
        await migrationRunner.connect();
        try {
            await new CreateNotificationCutoverLedger1792960197566().up(migrationRunner);
        } finally {
            await migrationRunner.release();
        }
        const actor = randomUUID();
        const postId = randomUUID();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [actor, `u_${actor.slice(0, 16)}`],
        );
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Rebuild fixture')",
            [postId, actor],
        );
        const statistics = new StatisticsService(dataSource);
        await statistics.recordView(actor, {
            sourceType: StatisticsSourceType.POST,
            sourceId: postId,
            viewId: randomUUID(),
        });
        const source = { sourceType: StatisticsSourceType.POST, sourceId: postId };
        await statistics.applyReaction(actor, source, true);
        await statistics.applyReaction(actor, source, false);
        await statistics.applyReaction(actor, source, true);
        const [target] = await dataSource.query(
            "SELECT statisticsTargetId FROM post WHERE id = ?",
            [postId],
        );
        const targetId = Number(target.statisticsTargetId);
        await new StatisticsProjectionService(dataSource).drain();
        const expectedTotals = await dataSource.query(
            "SELECT metricCode, metricValue FROM metric_total WHERE targetId = ? ORDER BY metricCode",
            [targetId],
        );
        const expectedHours = await dataSource.query(
            "SELECT metricCode, bucketStart, metricValue FROM metric_hour WHERE targetId = ? ORDER BY metricCode, bucketStart",
            [targetId],
        );
        const notificationSnapshot = await Promise.all([
            dataSource.getRepository(NotificationEvent).find({ order: { id: "ASC" } }),
            dataSource.getRepository(NotificationInbox).find({ order: { id: "ASC" } }),
            dataSource.getRepository(NotificationOutbox).find({ order: { createdAt: "ASC", id: "ASC" } }),
            dataSource.query("SELECT * FROM notification_cutover_state ORDER BY id"),
            dataSource.query("SELECT * FROM notification_cutover_job ORDER BY queueName, jobId"),
            dataSource.query("SELECT * FROM notification_cutover_exclusion ORDER BY legacyId"),
        ]);

        const createRunner = dataSource.createQueryRunner.bind(dataSource);
        let injected = false;
        const failure = jest.spyOn(dataSource, "createQueryRunner").mockImplementation((mode) => {
            const runner = createRunner(mode);
            const query = runner.query.bind(runner);
            jest.spyOn(runner, "query").mockImplementation(async (...args: any[]) => {
                if (
                    !injected &&
                    typeof args[0] === "string" &&
                    args[0].includes("UPDATE statistics_maintenance SET `cursor`")
                ) {
                    injected = true;
                    throw new Error("injected rebuild interruption");
                }
                return query(args[0], args[1], args[2]);
            });
            return runner;
        });
        try {
            await expect(maintenance.rebuild("test-backup", false, 10)).rejects.toThrow("injected rebuild interruption");
        } finally {
            failure.mockRestore();
        }
        expect(injected).toBe(true);
        expect(await maintenance.status()).toMatchObject({ state: "running", operation: "rebuild", cursor: null });
        await expect(
            dataSource.transaction((manager) => ensureStatisticsTarget(manager, StatisticsSourceType.POST, postId)),
        ).rejects.toThrow("Statistics maintenance is active");

        await expect(maintenance.rebuild("test-backup", true, 10)).resolves.toMatchObject({ state: "complete" });
        expect(await dataSource.query(
            "SELECT metricCode, metricValue FROM metric_total WHERE targetId = ? ORDER BY metricCode",
            [targetId],
        )).toEqual(expectedTotals);
        expect(await dataSource.query(
            "SELECT metricCode, bucketStart, metricValue FROM metric_hour WHERE targetId = ? ORDER BY metricCode, bucketStart",
            [targetId],
        )).toEqual(expectedHours);
        expect(await dataSource.getRepository(StatisticsEvent).findBy({ targetId })).toHaveLength(4);

        await maintenance.rebuild("test-backup", false, 10);
        const afterNotifications = await Promise.all([
            dataSource.getRepository(NotificationEvent).find({ order: { id: "ASC" } }),
            dataSource.getRepository(NotificationInbox).find({ order: { id: "ASC" } }),
            dataSource.getRepository(NotificationOutbox).find({ order: { createdAt: "ASC", id: "ASC" } }),
            dataSource.query("SELECT * FROM notification_cutover_state ORDER BY id"),
            dataSource.query("SELECT * FROM notification_cutover_job ORDER BY queueName, jobId"),
            dataSource.query("SELECT * FROM notification_cutover_exclusion ORDER BY legacyId"),
        ]);
        expect(afterNotifications).toEqual(notificationSnapshot);
    });
});
