import "reflect-metadata";
import { DataSource } from "typeorm";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { randomUUID } from "node:crypto";
import { createBaselineTables } from "../../test/baseline-schema";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";

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
        } finally {
            await runner.release();
        }
        await createBaselineTables(dataSource, [
            "notification_event",
            "notification_inbox",
            "notification_outbox",
        ]);
    });

    it("creates every entity column and index from the baseline schema", async () => {
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
                        `Missing baseline table ${metadata.tableName}`,
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
