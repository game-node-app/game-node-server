import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { RetireLegacyStatisticsStorage1792960197570 } from "../migrations/1792960197570-RetireLegacyStatisticsStorage";
import { PrepareStatisticsStorage1792960197568 } from "../migrations/1792960197568-PrepareStatisticsStorage";
import { StatisticsMaintenanceService } from "./statistics-maintenance.service";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { NotificationEvent } from "../notifications/entity/notification-event.entity";
import { NotificationInbox } from "../notifications/entity/notification-inbox.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { NotificationsProjectorService } from "../notifications/notifications-projector.service";
import { CreateNotificationCutoverLedger1792960197566 } from "../migrations/1792960197566-CreateNotificationCutoverLedger";

describe("statistics legacy conversion", () => {
    let dataSource: DataSource;
    let maintenance: StatisticsMaintenanceService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await dataSource.query("UPDATE statistics_target t JOIN post p ON p.statisticsTargetId = t.id SET t.sourceType = 'post' WHERE t.sourceType <> 'post'");
        maintenance = new StatisticsMaintenanceService(dataSource, new StatisticsRankingService(dataSource));
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it("converts bounded legacy facts and pending view/create work once, then retires legacy tables", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = randomUUID();
        for (const [userId, username] of [[owner, `owner_${owner.slice(0, 12)}`], [actor, `actor_${actor.slice(0, 12)}`]])
            await dataSource.query("INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())", [userId, username]);
        await dataSource.query("INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Legacy source')", [postId, owner]);

        for (const table of ["user_like", "user_view", "post_statistics"])
            await dataSource.query(`DROP TABLE IF EXISTS \`${table}\``);
        await dataSource.query(`CREATE TABLE post_statistics (
            id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            viewsCount BIGINT NOT NULL DEFAULT 0,
            likesCount BIGINT NOT NULL DEFAULT 0,
            postId CHAR(36) NOT NULL UNIQUE
        ) ENGINE=InnoDB`);
        await dataSource.query(`CREATE TABLE user_like (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            gameStatisticsId INT NULL, reviewStatisticsId INT NULL, activityStatisticsId INT NULL,
            commentStatisticsId INT NULL, postStatisticsId INT NULL, profileUserId CHAR(36) NOT NULL,
            createdAt DATETIME(6) NOT NULL, updatedAt DATETIME(6) NOT NULL
        ) ENGINE=InnoDB`);
        await dataSource.query(`CREATE TABLE user_view (
            id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
            gameStatisticsId INT NULL, reviewStatisticsId INT NULL, activityStatisticsId INT NULL,
            commentStatisticsId INT NULL, postStatisticsId INT NULL, profileUserId CHAR(36) NULL,
            createdAt DATETIME(6) NOT NULL, updatedAt DATETIME(6) NOT NULL
        ) ENGINE=InnoDB`);
        const legacyId = randomInt(1_000_000, 2_000_000_000);
        const likeId = randomInt(1_000_000, 2_000_000_000);
        const actorViewId = randomInt(1_000_000, 2_000_000_000);
        const anonymousViewId = actorViewId + 1;
        await dataSource.query("INSERT INTO post_statistics (id, viewsCount, likesCount, postId) VALUES (?, 4, 1, ?)", [legacyId, postId]);
        await dataSource.query("INSERT INTO user_like (id, postStatisticsId, profileUserId, createdAt, updatedAt) VALUES (?, ?, ?, '2024-02-03 04:05:06.123456', '2024-02-03 04:05:06.123456')", [likeId, legacyId, actor]);
        await dataSource.query("INSERT INTO user_view (id, postStatisticsId, profileUserId, createdAt, updatedAt) VALUES (?, ?, ?, '2024-02-04 04:05:06', '2024-02-04 04:05:06'), (?, ?, NULL, '2024-02-05 04:05:06', '2024-02-05 04:05:06')", [actorViewId, legacyId, actor, anonymousViewId, legacyId]);
        const oldLikeEventId = `legacy-notification-${randomUUID()}`;
        const oldLikeToken = `legacy-token-${randomUUID()}`;
        await dataSource.getRepository(NotificationOutbox).save({
            id: oldLikeEventId,
            eventType: "content.liked",
            eventVersion: 1,
            occurredAt: new Date("2024-02-03T04:05:06Z"),
            recipientUserId: owner,
            actorUserId: actor,
            payload: { likeId: 77, subjectType: "post", subjectId: postId },
            state: "processing",
            ownerToken: oldLikeToken,
            ownerExpiresAt: new Date(Date.now() + 60_000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        await dataSource.query(
            `INSERT INTO statistics_maintenance (id, operation, state, \`cursor\`, historyCompleteSince, backupReference, report)
            VALUES ('main', 'idle', 'pending', NULL, NULL, NULL, NULL)
            ON DUPLICATE KEY UPDATE operation='idle', state='pending', \`cursor\`=NULL, historyCompleteSince=NULL, backupReference=NULL, report=NULL`,
        );
        const prepareRunner = dataSource.createQueryRunner();
        await prepareRunner.connect();
        try {
            await new PrepareStatisticsStorage1792960197568().up(prepareRunner);
            await new CreateNotificationCutoverLedger1792960197566().up(prepareRunner);
        }
        finally { await prepareRunner.release(); }

        const notificationSnapshot = await Promise.all([
            dataSource.getRepository(NotificationEvent).find({ order: { id: "ASC" } }),
            dataSource.getRepository(NotificationInbox).find({ order: { id: "ASC" } }),
            dataSource.getRepository(NotificationOutbox).find({ order: { id: "ASC" } }),
            dataSource.query("SELECT * FROM notification_cutover_state ORDER BY id"),
            dataSource.query("SELECT * FROM notification_cutover_job ORDER BY queueName, jobId"),
            dataSource.query("SELECT * FROM notification_cutover_exclusion ORDER BY legacyId"),
        ]);

        let result = await maintenance.convertLegacyBatch("statistics-test-backup", false, 2);
        while (result.cursor.phase !== "queue" && result.cursor.phase !== "ready" && result.cursor.phase !== "complete")
            result = await maintenance.convertLegacyBatch("statistics-test-backup", true, 2);
        const queueViewId = `retry-safe-view-${randomUUID()}`;
        if (result.cursor.phase === "queue") {
            const jobs = [
                { id: queueViewId, name: "view", data: { sourceType: "post", sourceId: postId, userId: actor }, timestamp: Date.parse("2024-02-06T04:05:06Z") },
                { id: "archived-like-1", name: "like", data: { sourceType: "post", sourceId: postId }, timestamp: Date.now() },
                { id: "create-1", name: "create", data: { sourceType: "post", sourceId: postId }, timestamp: Date.now() },
            ];
            await maintenance.captureLegacyQueueBatch("wait", 0, jobs as any, false, 10);
            for (const state of ["paused", "delayed", "active", "failed", "completed", "waiting-children", "prioritized"])
                await maintenance.captureLegacyQueueBatch(state, 0, [], false, 10);
        }
        const converted = await maintenance.finishConversion("statistics-test-backup");
        expect(converted).toMatchObject({ state: "complete", operation: "conversion" });

        const [target] = await dataSource.query("SELECT statisticsTargetId FROM post WHERE id = ?", [postId]);
        const targetId = Number(target.statisticsTargetId);
        expect(await dataSource.query("SELECT DATE_FORMAT(occurredAt, '%Y-%m-%d %H:%i:%s.%f') AS occurredAt FROM statistics_event WHERE eventKey = ?", [`legacy:like:${likeId}`]))
            .toEqual([{ occurredAt: "2024-02-03 04:05:06.123456" }]);
        expect(await dataSource.query("SELECT eventKey, eventKind, provenance, firstLikeCredit FROM statistics_event WHERE targetId = ? ORDER BY eventKey", [targetId])).toEqual(expect.arrayContaining([
            expect.objectContaining({ eventKey: expect.stringMatching(/^legacy:like:/), eventKind: "like.added", provenance: "legacy-recorded", firstLikeCredit: 1 }),
            expect.objectContaining({ eventKey: expect.stringMatching(/^legacy:view:/), eventKind: "view.recorded", provenance: "legacy-recorded" }),
            expect.objectContaining({ eventKey: `legacy:view-job:${queueViewId}`, eventKind: "view.recorded", provenance: "legacy-job" }),
        ]));
        expect(await dataSource.query("SELECT COUNT(*) AS count FROM statistics_event WHERE targetId = ? AND eventKind = 'view.recorded'", [targetId])).toEqual([{ count: 3 }]);
        expect(await dataSource.query("SELECT likedAt, firstLikedAt, lastViewedAt FROM engagement_state WHERE targetId = ? AND profileUserId = ?", [targetId, actor])).toHaveLength(1);
        const report = typeof converted.report === "string" ? JSON.parse(converted.report) : converted.report;
        expect(report.conversion.queue).toMatchObject({ importedViews: 1, initializedSources: 1, archivedLikeJobsSkipped: 1 });
        expect(report.conversion.counterCorrections).toEqual(expect.arrayContaining([
            expect.objectContaining({ sourceType: "post", viewMismatchRows: 1, viewDifference: 1, likeMismatchRows: 0 }),
        ]));

        await expect(maintenance.convertLegacyBatch("statistics-test-backup", false, 2)).resolves.toMatchObject({ hasMore: false });
        await maintenance.rebuild("statistics-test-backup", false, 10);
        expect(await dataSource.query("SELECT metricCode, metricValue FROM metric_total WHERE targetId = ? ORDER BY metricCode", [targetId])).toEqual([
            { metricCode: "like_credit", metricValue: 1 },
            { metricCode: "likes_added", metricValue: 1 },
            { metricCode: "likes_current", metricValue: 1 },
            { metricCode: "likes_removed", metricValue: 0 },
            { metricCode: "views", metricValue: 3 },
        ]);

        const runner = dataSource.createQueryRunner();
        await runner.connect();
        try {
            await new RetireLegacyStatisticsStorage1792960197570().up(runner);
            for (const table of ["user_like", "user_view", "post_statistics"]) {
                const [remaining] = await runner.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?", [table]);
                expect(Number(remaining.count)).toBe(0);
            }
        } finally { await runner.release(); }
        const afterNotifications = await Promise.all([
            dataSource.getRepository(NotificationEvent).find({ order: { id: "ASC" } }),
            dataSource.getRepository(NotificationInbox).find({ order: { id: "ASC" } }),
            dataSource.getRepository(NotificationOutbox).find({ order: { id: "ASC" } }),
            dataSource.query("SELECT * FROM notification_cutover_state ORDER BY id"),
            dataSource.query("SELECT * FROM notification_cutover_job ORDER BY queueName, jobId"),
            dataSource.query("SELECT * FROM notification_cutover_exclusion ORDER BY legacyId"),
        ]);
        expect(afterNotifications).toEqual(notificationSnapshot);
        const projector = new NotificationsProjectorService(dataSource, {} as any);
        await expect(projector.projectEvent(oldLikeEventId, oldLikeToken)).resolves.toBe(true);
        expect(await dataSource.getRepository(NotificationEvent).findOneBy({ eventId: oldLikeEventId })).toMatchObject({
            recipientUserId: owner,
            actorUserId: actor,
            eventType: "content.liked",
            subjectId: postId,
        });
    });
});
