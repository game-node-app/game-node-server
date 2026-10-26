import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { randomUUID } from "crypto";
import { NotificationsCutoverService } from "./notifications-cutover.service";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { CreateNotificationCutoverLedger1792960197566 } from "../migrations/1792960197566-CreateNotificationCutoverLedger";
import { RetireLegacyNotificationStorage1792960197567 } from "../migrations/1792960197567-RetireLegacyNotificationStorage";
import { createLegacyNotificationFixtures } from "../../test/notifications/legacy-notification-fixtures";

describe("One-time data and queue cutover (Section 8)", () => {
    let dataSource: DataSource;
    let cutoverService: NotificationsCutoverService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await createLegacyNotificationFixtures(dataSource);
        const runner = dataSource.createQueryRunner();
        try {
            await new CreateNotificationCutoverLedger1792960197566().up(runner);
        } finally {
            await runner.release();
        }
        await dataSource.query("DELETE FROM notification");
        await dataSource.query("DELETE FROM notification_cutover_state");
        await dataSource.query("DELETE FROM notification_cutover_exclusion");
        cutoverService = new NotificationsCutoverService(dataSource);
    });

    it("rolls back contributions and checkpoint together after an interruption, then resumes once", async () => {
        const owner = randomUUID(),
            actor = randomUUID(),
            postId = randomUUID();
        for (const user of [owner, actor]) await createProfile(user);
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Atomic conversion')",
            [postId, owner],
        );
        const row = await dataSource.query(
            "INSERT INTO notification (sourceType, category, postId, profileUserId, targetProfileUserId, isViewed) VALUES ('post', 'like', ?, ?, ?, 1)",
            [postId, actor, owner],
        );
        const before = await dataSource.query(
            "SELECT * FROM notification_cutover_state WHERE id = 'legacy'",
        );
        const contribute = (cutoverService as any).contribute.bind(
            cutoverService,
        );
        const failure = jest
            .spyOn(cutoverService as any, "contribute")
            .mockImplementationOnce(async (...args: any[]) => {
                await contribute(...args);
                throw new Error("interrupted after event insertion");
            });
        await expect(
            cutoverService.convertLegacyNotifications(1),
        ).rejects.toThrow("interrupted");
        failure.mockRestore();
        expect(
            await dataSource
                .getRepository(NotificationEvent)
                .countBy({ eventId: `legacy-notification-${row.insertId}` }),
        ).toBe(0);
        expect(
            await dataSource
                .getRepository(NotificationInbox)
                .countBy({ recipientUserId: owner }),
        ).toBe(0);
        expect(
            await dataSource.query(
                "SELECT * FROM notification_cutover_state WHERE id = 'legacy'",
            ),
        ).toEqual(before);
        expect(
            (await cutoverService.convertLegacyNotifications(1)).convertedCount,
        ).toBe(1);
        expect(
            await dataSource
                .getRepository(NotificationInbox)
                .findOneByOrFail({ recipientUserId: owner }),
        ).toMatchObject({
            eventCount: 1,
            actorCount: 1,
            version: 1,
            readVersion: 1,
        });
        expect(
            (await cutoverService.convertLegacyNotifications(1)).convertedCount,
        ).toBe(0);
    });

    afterAll(async () => {
        if (dataSource && dataSource.isInitialized) {
            await dataSource.destroy();
        }
    });

    async function createProfile(userId: string) {
        await dataSource.query(
            `INSERT INTO profile (userId, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)`,
            [userId, `u_${userId.slice(0, 6)}`],
        );
    }

    it("converts mixed read groups conservatively: group remains unread if any legacy event is unread", async () => {
        const owner = randomUUID();
        const actor1 = randomUUID();
        const actor2 = randomUUID();
        const postId = randomUUID();

        await createProfile(owner);
        await createProfile(actor1);
        await createProfile(actor2);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post for conversion', NOW(), NOW())`,
            [postId, owner],
        );

        // Insert two legacy like notifications for the same post on the same day:
        // One is viewed, one is unviewed
        await dataSource.query(
            `INSERT INTO notification (sourceType, category, postId, profileUserId, targetProfileUserId, isViewed, createdAt, updatedAt)
             VALUES ('POST', 'LIKE', ?, ?, ?, 1, NOW(), NOW())`,
            [postId, actor1, owner],
        );
        await dataSource.query(
            `INSERT INTO notification (sourceType, category, postId, profileUserId, targetProfileUserId, isViewed, createdAt, updatedAt)
             VALUES ('POST', 'LIKE', ?, ?, ?, 0, NOW(), NOW())`,
            [postId, actor2, owner],
        );

        const res = await cutoverService.convertLegacyNotifications();
        expect(res.convertedCount).toBeGreaterThanOrEqual(2);

        const group = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({
                recipientUserId: owner,
                rootId: postId,
            });

        expect(group.eventCount).toBe(2);
        expect(group.version).toBe(2);
        expect(group.readVersion).toBe(0); // Mixed read state -> remains unread!
    });

    it("is restart-safe and idempotent: repeated conversion does not duplicate contributions", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = randomUUID();

        await createProfile(owner);
        await createProfile(actor);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Idempotent post', NOW(), NOW())`,
            [postId, owner],
        );

        const insertRes = await dataSource.query(
            `INSERT INTO notification (sourceType, category, postId, profileUserId, targetProfileUserId, isViewed, createdAt, updatedAt)
             VALUES ('POST', 'LIKE', ?, ?, ?, 1, NOW(), NOW())`,
            [postId, actor, owner],
        );
        const notificationId = insertRes.insertId;

        // Run conversion pass 1
        const run1 = await cutoverService.convertLegacyNotifications();
        expect(run1.convertedCount).toBeGreaterThan(0);

        const group1 = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({
                recipientUserId: owner,
                rootId: postId,
            });
        const events1 = await dataSource.getRepository(NotificationEvent).find({
            where: { eventId: `legacy-notification-${notificationId}` },
        });
        expect(events1).toHaveLength(1);

        // Run conversion pass 2 (simulating restart)
        await cutoverService.convertLegacyNotifications();

        const group2 = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({
                recipientUserId: owner,
                rootId: postId,
            });
        const events2 = await dataSource.getRepository(NotificationEvent).find({
            where: { eventId: `legacy-notification-${notificationId}` },
        });

        // Event count and version must remain identical!
        expect(events2).toHaveLength(1);
        expect(group2.eventCount).toBe(group1.eventCount);
        expect(group2.version).toBe(group1.version);
    });

    it("excludes forged recipients, unassignable globals, and missing roots", async () => {
        const realOwner = randomUUID();
        const forgedRecipient = randomUUID();
        const actor = randomUUID();
        const postId = randomUUID();

        await createProfile(realOwner);
        await createProfile(forgedRecipient);
        await createProfile(actor);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post for security check', NOW(), NOW())`,
            [postId, realOwner],
        );

        // 1. Forged recipient
        await dataSource.query(
            `INSERT INTO notification (sourceType, category, postId, profileUserId, targetProfileUserId, isViewed, createdAt, updatedAt)
             VALUES ('POST', 'LIKE', ?, ?, ?, 0, NOW(), NOW())`,
            [postId, actor, forgedRecipient], // Forged: post belongs to realOwner, not forgedRecipient!
        );

        // 2. Unassignable global (targetProfileUserId IS NULL)
        await dataSource.query(
            `INSERT INTO notification (sourceType, category, postId, profileUserId, targetProfileUserId, isViewed, createdAt, updatedAt)
             VALUES ('POST', 'LIKE', ?, ?, NULL, 0, NOW(), NOW())`,
            [postId, actor],
        );

        // 3. Missing post root (soft-deleted post)
        const deletedPostId = randomUUID();
        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, deletedAt, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Soft-deleted post', NOW(), NOW(), NOW())`,
            [deletedPostId, realOwner],
        );

        await dataSource.query(
            `INSERT INTO notification (sourceType, category, postId, profileUserId, targetProfileUserId, isViewed, createdAt, updatedAt)
             VALUES ('POST', 'LIKE', ?, ?, ?, 0, NOW(), NOW())`,
            [deletedPostId, actor, realOwner],
        );

        const res = await cutoverService.convertLegacyNotifications();
        expect(res.excludedCount).toBeGreaterThanOrEqual(3);

        const reasons = res.exclusions.map((e) => e.reason);
        expect(reasons).toContain("forged_recipient");
        expect(reasons).toContain("unassignable_global");
        expect(reasons).toContain("source_not_found");

        // Verify forged recipient has NO inbox item
        const forgedInbox = await dataSource
            .getRepository(NotificationInbox)
            .findOneBy({
                recipientUserId: forgedRecipient,
                rootId: postId,
            });
        expect(forgedInbox).toBeNull();
    });

    it("transfers pending importer results to notification_outbox and clears pendingDelivery", async () => {
        const userId = randomUUID();
        await createProfile(userId);

        await dataSource.query(
            `INSERT INTO library (userId, createdAt, updatedAt) VALUES (?, NOW(), NOW()) ON DUPLICATE KEY UPDATE userId = userId`,
            [userId],
        );

        const insertRes = await dataSource.query(
            `INSERT INTO importer_watch_notification
             (libraryUserId, source, autoImportedCount, autoImportSkippedCount, autoImportFailedCount, pendingDelivery)
             VALUES (?, 'steam', 10, 2, 1, 1)`,
            [userId],
        );
        const importerNotificationId = insertRes.insertId;

        const transferred =
            await cutoverService.transferPendingImporterResults();
        expect(transferred).toBeGreaterThanOrEqual(1);

        // Verify pendingDelivery is cleared
        const rows = await dataSource.query(
            `SELECT pendingDelivery FROM importer_watch_notification WHERE id = ?`,
            [importerNotificationId],
        );
        expect(rows[0].pendingDelivery).toBe(0);

        // Verify outbox record created
        const outbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOneByOrFail({
                id: `importer-result-${importerNotificationId}`,
            });
        expect(outbox.recipientUserId).toBe(userId);
        expect(outbox.eventType).toBe("import.discovery-completed");
        expect(outbox.state).toBe("pending");
        expect(outbox.payload.importedCount).toBe(10);
        expect(outbox.payload.skippedCount).toBe(2);
        expect(outbox.payload.failedCount).toBe(1);
    });

    it("preserves exact distinct actors and generic unknown-trigger previews, and groups replies by their known parent", async () => {
        const owner = randomUUID(),
            parentOwner = randomUUID(),
            postId = randomUUID(),
            parentId = randomUUID();
        const actors = Array.from({ length: 4 }, () => randomUUID());
        for (const user of [owner, parentOwner, ...actors])
            await createProfile(user);
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Historical root')",
            [postId, owner],
        );
        await dataSource.query(
            "INSERT INTO post_comment (id, profileUserId, postId, content) VALUES (?, ?, ?, '<script>private parent body</script>')",
            [parentId, parentOwner, postId],
        );
        for (const [index, actor] of [...actors, actors[0]].entries())
            await dataSource.query(
                "INSERT INTO notification (sourceType, category, postId, profileUserId, targetProfileUserId, isViewed, createdAt) VALUES ('post', 'comment', ?, ?, ?, ?, '2026-10-25 12:00:00')",
                [postId, actor, owner, index === 2 ? 0 : 1],
            );
        await dataSource.query(
            "INSERT INTO notification (sourceType, category, postCommentId, profileUserId, targetProfileUserId, isViewed) VALUES ('post_comment', 'comment', ?, ?, ?, 1)",
            [parentId, actors[0], parentOwner],
        );
        while ((await cutoverService.convertLegacyNotifications(2)).hasMore) {
            /* bounded resumable batches */
        }
        const group = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({ recipientUserId: owner });
        expect(group).toMatchObject({
            eventCount: 5,
            actorCount: 4,
            version: 5,
            readVersion: 0,
            preview: { text: "Shared a comment" },
            triggerCommentId: null,
        });
        expect(group.actorIds).toHaveLength(3);
        const reply = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({ recipientUserId: parentOwner });
        expect(reply).toMatchObject({
            type: "comment.replied",
            subjectType: "comment",
            subjectId: parentId,
            rootType: "post",
            rootId: postId,
            version: 1,
            readVersion: 1,
        });
        expect(reply.target).not.toHaveProperty("focusId");
        expect(JSON.stringify(reply)).not.toContain("private parent body");
        expect(
            (await cutoverService.convertLegacyNotifications()).convertedCount,
        ).toBe(0);
    });

    it("transfers exact discovery counts even when automatic importing was disabled", async () => {
        const owner = randomUUID();
        await createProfile(owner);
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            owner,
        ]);
        const result = await dataSource.query(
            "INSERT INTO importer_watch_notification (libraryUserId, source, pendingDelivery) VALUES (?, 'steam', 1)",
            [owner],
        );
        for (let index = 0; index < 5; index++) {
            const id = Date.now() * 10 + index;
            await dataSource.query(
                "INSERT INTO game_external_game (id, gameId, uid, category) VALUES (?, 1, ?, 1)",
                [id, String(id)],
            );
            await dataSource.query(
                "INSERT INTO importer_watch_notification_games_game_external_game VALUES (?, ?)",
                [result.insertId, id],
            );
        }
        expect(await cutoverService.transferPendingImporterResults()).toBe(1);
        const outbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOneByOrFail({ id: `importer-result-${result.insertId}` });
        expect(outbox.payload).toMatchObject({
            gameCount: 5,
            importedCount: 0,
            skippedCount: 0,
            failedCount: 0,
        });
        expect(outbox.payload.gameSample).toHaveLength(3);
        expect(await cutoverService.transferPendingImporterResults()).toBe(0);
    });

    it("durably inventories paused legacy notification and like work without replaying or removing jobs", async () => {
        for (const [name, jobName] of [
            ["notifications-queue", "notifications-register"],
            ["statistics-queue", "like"],
        ]) {
            const jobs = [
                {
                    id: randomUUID(),
                    name: jobName,
                    data: {
                        sourceId: "old-source",
                        targetUserId: "untrusted-recipient",
                    },
                },
            ];
            const queue = {
                name,
                isPaused: async () => true,
                getJobs: jest.fn(async ([state]) =>
                    state === "paused" ? jobs : [],
                ),
            };
            expect(
                await cutoverService.captureLegacyQueue(queue as any),
            ).toEqual({ captured: 1, hasMore: false });
            const records = await dataSource.query(
                "SELECT jobName, payload FROM notification_cutover_job WHERE queueName = ? AND jobId = ?",
                [name, jobs[0].id],
            );
            expect(records[0].jobName).toBe(jobName);
            expect(
                typeof records[0].payload === "string"
                    ? JSON.parse(records[0].payload)
                    : records[0].payload,
            ).toEqual(jobs[0].data);
            expect(
                await cutoverService.captureLegacyQueue(queue as any),
            ).toEqual({ captured: 0, hasMore: false });
        }
    });

    it("guards destructive cleanup until conversion, inventory and backup verification, preserving domain rows", async () => {
        const runner = dataSource.createQueryRunner();
        const cleanup = new RetireLegacyNotificationStorage1792960197567();
        const counts = () =>
            dataSource.query(`SELECT (SELECT COUNT(*) FROM post) AS posts,
            (SELECT COUNT(*) FROM importer_notified_entry) AS retryRows, (SELECT COUNT(*) FROM importer_processed_entry) AS processed,
            (SELECT COUNT(*) FROM importer_ignored_entry) AS ignored, (SELECT COUNT(*) FROM importer_watch_notification) AS results`);
        try {
            const before = await counts();
            await expect(cleanup.up(runner)).rejects.toThrow("backup");
            expect(await runner.hasTable("notification")).toBe(true);
            await cutoverService.verify("disposable-coordinated-backup");
            await cleanup.up(runner);
            expect(await runner.hasTable("notification")).toBe(false);
            expect(
                await runner.hasColumn(
                    "importer_watch_notification",
                    "pendingDelivery",
                ),
            ).toBe(false);
            expect(
                dataSource.entityMetadatas.some(
                    (entity) => entity.tableName === "notification",
                ),
            ).toBe(false);
            expect(await counts()).toEqual(before);
            await expect(cleanup.down()).rejects.toThrow("backup");
        } finally {
            await runner.release();
        }
    });
});
