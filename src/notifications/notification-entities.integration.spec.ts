import "reflect-metadata";
import { DataSource } from "typeorm";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { randomUUID } from "node:crypto";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { CreateNotificationOutboxAndInbox1792960197563 } from "../migrations/1792960197563-CreateNotificationOutboxAndInbox";
import { RecoverImporterNotifications1792886400004 } from "../migrations/1792886400004-RecoverImporterNotifications";
import { NotificationTimestampPrecision1792960197564 } from "../migrations/1792960197564-NotificationTimestampPrecision";
import { IndexNotificationCommentTriggers1792960197565 } from "../migrations/1792960197565-IndexNotificationCommentTriggers";

describe("Notification entities on MySQL", () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        const runner = dataSource.createQueryRunner();
        try {
            for (const table of [
                "notification_event",
                "notification_inbox",
                "notification_outbox",
            ]) {
                await runner.dropTable(table);
            }
            await new CreateNotificationOutboxAndInbox1792960197563().up(
                runner,
            );
            await new NotificationTimestampPrecision1792960197564().up(runner);
            await new IndexNotificationCommentTriggers1792960197565().up(runner);
        } finally {
            await runner.release();
        }
    });

    it("creates every entity column and index from the checked-in migration", async () => {
        const runner = dataSource.createQueryRunner();
        try {
            for (const entity of [
                NotificationOutbox,
                NotificationInbox,
                NotificationEvent,
            ]) {
                const metadata = dataSource.getMetadata(entity);
                const table = await runner.getTable(metadata.tableName);
                if (!table)
                    throw new Error(
                        `Missing migrated table ${metadata.tableName}`,
                    );
                expect(
                    table.columns.map((column) => column.name).sort(),
                ).toEqual(
                    metadata.columns
                        .map((column) => column.databaseName)
                        .sort(),
                );
                for (const index of metadata.indices) {
                    expect(table.indices).toEqual(
                        expect.arrayContaining([
                            expect.objectContaining({
                                name: index.name,
                                columnNames: index.columns.map(
                                    (column) => column.databaseName,
                                ),
                                isUnique: index.isUnique,
                            }),
                        ]),
                    );
                }
            }
        } finally {
            await runner.release();
        }
    });

    it("upgrades importer delivery without changing committed choices or source rows", async () => {
        const runner = dataSource.createQueryRunner();
        await runner.connect();
        try {
            // Temporary tables shadow the fixture tables on this connection only.
            await runner.query(
                "CREATE TEMPORARY TABLE importer_notified_entry (id INT PRIMARY KEY, processed TINYINT, ignored TINYINT)",
            );
            await runner.query(
                "CREATE TEMPORARY TABLE importer_watch_notification (id INT PRIMARY KEY, autoImportCount INT)",
            );
            await runner.query(
                "CREATE TEMPORARY TABLE notification (id INT PRIMARY KEY, viewed TINYINT)",
            );
            await runner.query(
                "INSERT INTO importer_notified_entry VALUES (1, 1, 0), (2, 0, 1)",
            );
            await runner.query(
                "INSERT INTO importer_watch_notification VALUES (1, 7)",
            );
            await runner.query("INSERT INTO notification VALUES (1, 1)");

            await new RecoverImporterNotifications1792886400004().up(runner);

            expect(
                await runner.query(
                    "SELECT * FROM importer_notified_entry ORDER BY id",
                ),
            ).toEqual([
                { id: 1, processed: 1, ignored: 0, autoImportRetryable: 0 },
                { id: 2, processed: 0, ignored: 1, autoImportRetryable: 0 },
            ]);
            expect(
                await runner.query("SELECT * FROM importer_watch_notification"),
            ).toEqual([
                {
                    id: 1,
                    autoImportCount: 7,
                    autoImportFailedCount: 0,
                    pendingDelivery: 0,
                },
            ]);
            expect(await runner.query("SELECT * FROM notification")).toEqual([
                { id: 1, viewed: 1, deliveryIdentity: null },
            ]);
            await runner.query(
                "UPDATE notification SET deliveryIdentity = 'discovery-1' WHERE id = 1",
            );
            await expect(
                runner.query(
                    "INSERT INTO notification (id, viewed, deliveryIdentity) VALUES (2, 0, 'discovery-1')",
                ),
            ).rejects.toThrow();
        } finally {
            for (const table of [
                "notification",
                "importer_watch_notification",
                "importer_notified_entry",
            ]) {
                await runner.query(`DROP TEMPORARY TABLE IF EXISTS ${table}`);
            }
            await runner.release();
        }
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    it("verifies notification_outbox primary key uniqueness", async () => {
        const repo = dataSource.getRepository(NotificationOutbox);
        const id = `test-outbox-${randomUUID()}`;
        const record = repo.create({
            id,
            eventType: "content.liked",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: "user-1",
            actorUserId: "user-2",
            payload: { subjectId: "sub-1" },
            state: "pending",
            attempts: 0,
            nextAttemptAt: new Date(),
        });
        await repo.save(record);

        const duplicate = repo.create({
            id,
            eventType: "content.liked",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: "user-1",
            actorUserId: "user-3",
            payload: { subjectId: "sub-1" },
            state: "pending",
            attempts: 0,
            nextAttemptAt: new Date(),
        });

        await expect(repo.insert(duplicate)).rejects.toThrow();
        await repo.delete({ id });
    });

    it("verifies notification_event (eventId, recipientUserId) uniqueness", async () => {
        const repo = dataSource.getRepository(NotificationEvent);
        const eventId = `test-event-${randomUUID()}`;
        const recipientUserId = `user-${randomUUID()}`;

        const event1 = repo.create({
            eventId,
            recipientUserId,
            groupKey: "group-1",
            eventType: "comment.created",
            actorUserId: "actor-1",
            occurredAt: new Date(),
        });
        await repo.insert(event1);

        const duplicate = repo.create({
            eventId,
            recipientUserId,
            groupKey: "group-2",
            eventType: "comment.created",
            actorUserId: "actor-2",
            occurredAt: new Date(),
        });

        await expect(repo.insert(duplicate)).rejects.toThrow();
        await repo.delete({ eventId });
    });

    it("verifies notification_inbox (recipientUserId, groupKey) uniqueness", async () => {
        const repo = dataSource.getRepository(NotificationInbox);
        const recipientUserId = `user-${randomUUID()}`;
        const groupKey = `group-${randomUUID()}`;

        const inbox1 = repo.create({
            recipientUserId,
            groupKey,
            type: "comment.created",
            actorIds: ["actor-1"],
            eventCount: 1,
            actorCount: 1,
            lastEventAt: new Date(),
            version: 1,
            readVersion: 0,
            isVisible: true,
            isRedacted: false,
        });
        await repo.insert(inbox1);

        const duplicate = repo.create({
            recipientUserId,
            groupKey,
            type: "comment.created",
            actorIds: ["actor-2"],
            eventCount: 2,
            actorCount: 2,
            lastEventAt: new Date(),
            version: 2,
            readVersion: 0,
            isVisible: true,
            isRedacted: false,
        });

        await expect(repo.insert(duplicate)).rejects.toThrow();
        await repo.delete({ recipientUserId, groupKey });
    });
});
