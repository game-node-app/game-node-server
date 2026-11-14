import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { randomUUID } from "crypto";
import { NotificationsService } from "./notifications.service";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { Profile } from "../profile/entities/profile.entity";

describe("Read-all notifications (Section 7)", () => {
    let dataSource: DataSource;
    let service: NotificationsService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();

        service = new NotificationsService(
            dataSource.getRepository(NotificationInbox),
            dataSource.getRepository(Profile),
            dataSource,
        );
    });

    afterAll(async () => {
        if (dataSource && dataSource.isInitialized) {
            await dataSource.destroy();
        }
    });

    const repo = () => dataSource.getRepository(NotificationInbox);

    async function saveInbox(
        recipientUserId: string,
        values: Partial<NotificationInbox> = {},
    ): Promise<NotificationInbox> {
        return repo().save(
            repo().create({
                recipientUserId,
                groupKey: randomUUID(),
                type: "profile.followed",
                rootType: "profile",
                rootId: randomUUID(),
                actorIds: [],
                eventCount: 1,
                actorCount: 0,
                lastEventAt: new Date("2026-10-25T12:00:00.000Z"),
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
                ...values,
            }),
        );
    }

    it("marks only items at or before the cutoff and recomputes unreadCount", async () => {
        const recipient = randomUUID();
        const before = new Date("2026-10-25T12:00:00.000Z");
        const older = await saveInbox(recipient, {
            lastEventAt: new Date("2026-10-25T11:59:59.999Z"),
            version: 3,
        });
        const atCutoff = await saveInbox(recipient, {
            lastEventAt: before,
            version: 2,
        });
        const newer = await saveInbox(recipient, {
            lastEventAt: new Date("2026-10-25T12:00:00.001Z"),
        });

        try {
            const result = await service.acknowledgeReadAll(
                recipient,
                before.toISOString(),
            );
            expect(result).toEqual({ success: true, unreadCount: 1 });

            expect(
                (await repo().findOneByOrFail({ id: older.id })).readVersion,
            ).toBe(3);
            expect(
                (await repo().findOneByOrFail({ id: atCutoff.id })).readVersion,
            ).toBe(2);
            expect(
                (await repo().findOneByOrFail({ id: newer.id })).readVersion,
            ).toBe(0);

            const list = await service.findAll(recipient, { limit: 20 });
            expect(list.unreadCount).toBe(1);

            // A new event after the cutoff keeps the item unread.
            await repo().update(
                { id: newer.id },
                {
                    version: 2,
                    lastEventAt: new Date("2026-10-25T12:00:05.000Z"),
                },
            );
            expect(
                (
                    await service.acknowledgeReadAll(
                        recipient,
                        before.toISOString(),
                    )
                ).unreadCount,
            ).toBe(1);
            expect(
                (await repo().findOneByOrFail({ id: newer.id })).readVersion,
            ).toBe(0);
        } finally {
            await repo().delete({ recipientUserId: recipient });
        }
    });

    it("does not affect another recipient's items", async () => {
        const recipient = randomUUID();
        const other = randomUUID();
        const mine = await saveInbox(recipient);
        const theirs = await saveInbox(other);

        try {
            const result = await service.acknowledgeReadAll(
                recipient,
                new Date("2026-10-25T13:00:00.000Z").toISOString(),
            );
            expect(result.unreadCount).toBe(0);

            expect(
                (await repo().findOneByOrFail({ id: mine.id })).readVersion,
            ).toBe(mine.version);
            expect(
                (await repo().findOneByOrFail({ id: theirs.id })).readVersion,
            ).toBe(0);
            expect(
                (await service.findAll(other, { limit: 20 })).unreadCount,
            ).toBe(1);
        } finally {
            await repo().delete({ recipientUserId: recipient });
            await repo().delete({ recipientUserId: other });
        }
    });

    it("is idempotent and defaults the cutoff to the server time", async () => {
        const recipient = randomUUID();
        const item = await saveInbox(recipient, {
            lastEventAt: new Date(Date.now() - 60_000),
        });

        try {
            const first = await service.acknowledgeReadAll(recipient);
            const second = await service.acknowledgeReadAll(
                recipient,
                new Date().toISOString(),
            );

            expect(first).toEqual({ success: true, unreadCount: 0 });
            expect(second).toEqual(first);
            expect(
                (await repo().findOneByOrFail({ id: item.id })).readVersion,
            ).toBe(item.version);
        } finally {
            await repo().delete({ recipientUserId: recipient });
        }
    });

    it("does not acknowledge hidden or ineligible items", async () => {
        const recipient = randomUUID();
        const visible = await saveInbox(recipient);
        const hidden = await saveInbox(recipient, { isVisible: false });
        const ineligible = await saveInbox(recipient, {
            type: "content.liked",
            rootType: "post",
            rootId: randomUUID(),
        });

        try {
            const result = await service.acknowledgeReadAll(
                recipient,
                new Date("2026-10-25T13:00:00.000Z").toISOString(),
            );
            expect(result.unreadCount).toBe(0);

            expect(
                (await repo().findOneByOrFail({ id: visible.id })).readVersion,
            ).toBe(visible.version);
            expect(
                (await repo().findOneByOrFail({ id: hidden.id })).readVersion,
            ).toBe(0);
            expect(
                (await repo().findOneByOrFail({ id: ineligible.id }))
                    .readVersion,
            ).toBe(0);
        } finally {
            await repo().delete({ recipientUserId: recipient });
        }
    });
});
