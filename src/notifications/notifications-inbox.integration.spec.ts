import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { randomUUID } from "crypto";
import { BadRequestException } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { Profile } from "../profile/entities/profile.entity";
import { encodeNotificationCursor } from "./notifications.utils";

describe("Sole notifications inbox API and read state (Section 7)", () => {
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

    async function createProfile(userId: string, username: string) {
        await dataSource.query(
            `INSERT INTO profile (userId, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)`,
            [userId, username],
        );
    }

    it("returns empty inbox with zero unread count and no continuation", async () => {
        const userId = randomUUID();
        await createProfile(userId, `user_${userId.slice(0, 6)}`);

        const res = await service.findAll(userId, { limit: 20 });
        expect(res.data).toEqual([]);
        expect(res.pagination.hasMore).toBe(false);
        expect(res.pagination.nextCursor).toBeNull();
        expect(res.unreadCount).toBe(0);
    });

    it.each([
        { t: 1e30, i: 1 },
        { t: 0.5, i: 1 },
        { t: 0, i: -1 },
        { t: 0, i: 0 },
        { t: 0, i: 1.5 },
        { t: 0, i: Number.MAX_SAFE_INTEGER + 1 },
    ])("rejects invalid cursor date or identity: %j", async (fields) => {
        const userId = randomUUID();
        const cursor = Buffer.from(
            JSON.stringify({ u: userId, ...fields }),
        ).toString("base64url");
        await expect(service.findAll(userId, { cursor })).rejects.toThrow(
            BadRequestException,
        );
    });

    it.each([0, -1, 101, 1.5])(
        "rejects invalid page sizes before querying: %s",
        async (limit) => {
            await expect(
                service.findAll(randomUUID(), { limit }),
            ).rejects.toThrow(BadRequestException);
        },
    );

    it("refills [ineligible, B, C] without returning C again", async () => {
        const recipient = randomUUID();
        const repo = dataSource.getRepository(NotificationInbox);
        const items: NotificationInbox[] = [];
        for (let index = 0; index < 4; index++) {
            items.push(
                await repo.save({
                    recipientUserId: recipient,
                    groupKey: randomUUID(),
                    type: "profile.followed",
                    rootType: index === 0 ? "post" : "profile",
                    rootId: randomUUID(),
                    actorIds: [],
                    lastEventAt: new Date(
                        Date.UTC(2026, 9, 25, 12, 0, 4 - index),
                    ),
                    eventCount: 1,
                    actorCount: 0,
                    version: 1,
                    readVersion: 0,
                }),
            );
        }
        try {
            const first = await service.findAll(recipient, { limit: 2 });
            expect(first.data.map((item) => item.id)).toEqual([
                items[1].id,
                items[2].id,
            ]);
            expect(first.pagination.hasMore).toBe(true);
            const next = await service.findAll(recipient, {
                limit: 2,
                cursor: first.pagination.nextCursor!,
            });
            expect(next.data.map((item) => item.id)).toEqual([items[3].id]);
            expect(next.pagination.hasMore).toBe(false);
        } finally {
            await repo.delete({ recipientUserId: recipient });
        }
    });

    it("advances an empty page when its bounded candidate scan is exhausted", async () => {
        const recipient = randomUUID();
        const repo = dataSource.getRepository(NotificationInbox);
        for (let index = 0; index < 8; index++) {
            await repo.save({
                recipientUserId: recipient,
                groupKey: randomUUID(),
                type: "content.liked",
                rootType: "post",
                rootId: randomUUID(),
                actorIds: [],
                lastEventAt: new Date(Date.UTC(2026, 9, 25, 12, 0, index)),
                eventCount: 1,
                actorCount: 0,
                version: 1,
                readVersion: 0,
            });
        }
        try {
            const first = await service.findAll(recipient, { limit: 1 });
            expect(first.data).toEqual([]);
            expect(first.pagination.hasMore).toBe(true);
            expect(first.pagination.nextCursor).not.toBeNull();
            const next = await service.findAll(recipient, {
                limit: 1,
                cursor: first.pagination.nextCursor!,
            });
            expect(next.data).toEqual([]);
            expect(next.pagination.hasMore).toBe(false);
        } finally {
            await repo.delete({ recipientUserId: recipient });
        }
    });

    it("rejects cursors belonging to another recipient or malformed payloads", async () => {
        const userA = randomUUID();
        const userB = randomUUID();

        const foreignCursor = encodeNotificationCursor(userB, new Date(), 10);
        await expect(
            service.findAll(userA, { cursor: foreignCursor }),
        ).rejects.toThrow(BadRequestException);

        await expect(
            service.findAll(userA, { cursor: "not-a-valid-cursor" }),
        ).rejects.toThrow(BadRequestException);
    });

    it("paginates groups with deterministic tie-breakers and batch actor hydration", async () => {
        const recipient = randomUUID();
        const actor1 = randomUUID();
        const actor2 = randomUUID();

        await createProfile(recipient, `recip_${recipient.slice(0, 6)}`);
        await createProfile(actor1, `actor1_${actor1.slice(0, 6)}`);
        // Note: actor2 has no profile in the database (deleted/missing user)

        const sharedTime = new Date("2026-10-25T12:00:00.000Z");
        const olderTime = new Date("2026-10-25T11:00:00.000Z");

        const inboxRepo = dataSource.getRepository(NotificationInbox);

        // Item 1 (older)
        const item1 = await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `follow:${randomUUID()}`,
                type: "profile.followed",
                actorIds: [actor1],
                actorCount: 1,
                eventCount: 1,
                lastEventAt: olderTime,
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // Item 2 (shared timestamp, id 2)
        const item2 = await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `like:${randomUUID()}`,
                type: "content.liked",
                actorIds: [actor1, actor2],
                actorCount: 2,
                eventCount: 2,
                lastEventAt: sharedTime,
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // Item 3 (shared timestamp, higher id)
        const item3 = await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `like:${randomUUID()}`,
                type: "content.liked",
                actorIds: [actor1],
                actorCount: 1,
                eventCount: 1,
                lastEventAt: sharedTime,
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // Request page 1 with limit = 2
        const page1 = await service.findAll(recipient, { limit: 2 });
        expect(page1.data).toHaveLength(2);
        expect(page1.pagination.hasMore).toBe(true);
        expect(page1.pagination.nextCursor).toBeDefined();
        expect(page1.unreadCount).toBe(3);

        // Verify tie-breaker order: item3 (higher id) comes before item2 (lower id)
        expect(page1.data[0].id).toBe(item3.id);
        expect(page1.data[1].id).toBe(item2.id);

        // Verify public actor batch hydration on item2
        const item2Dto = page1.data[1];
        expect(item2Dto.actors).toHaveLength(2);
        expect(item2Dto.actors[0].userId).toBe(actor1);
        expect(item2Dto.actors[0].username).toContain("actor1");
        // actor2 missing profile -> safe placeholder
        expect(item2Dto.actors[1].userId).toBe(actor2);
        expect(item2Dto.actors[1].username).toBe("[Deleted User]");

        // Request page 2 with cursor
        const page2 = await service.findAll(recipient, {
            cursor: page1.pagination.nextCursor!,
            limit: 2,
        });
        expect(page2.data).toHaveLength(1);
        expect(page2.data[0].id).toBe(item1.id);
        expect(page2.pagination.hasMore).toBe(false);
        expect(page2.pagination.nextCursor).toBeNull();
    });

    it("verifies read acknowledgements: monotonic, session-scoped, future-rejection, concurrent unread", async () => {
        const recipient = randomUUID();
        const otherUser = randomUUID();
        await createProfile(recipient, `recip_${recipient.slice(0, 6)}`);
        await createProfile(otherUser, `other_${otherUser.slice(0, 6)}`);

        const inboxRepo = dataSource.getRepository(NotificationInbox);

        const myItem = await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `item:${randomUUID()}`,
                type: "comment.created",
                actorIds: [],
                actorCount: 1,
                eventCount: 3,
                lastEventAt: new Date(),
                version: 3,
                readVersion: 1,
                isVisible: true,
                isRedacted: false,
            }),
        );

        const otherItem = await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: otherUser,
                groupKey: `other:${randomUUID()}`,
                type: "comment.created",
                actorIds: [],
                actorCount: 1,
                eventCount: 1,
                lastEventAt: new Date(),
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // 1. Reject acknowledging an item belonging to another user
        await expect(
            service.acknowledgeRead(recipient, {
                items: [{ id: otherItem.id, version: 1 }],
            }),
        ).rejects.toThrow(BadRequestException);

        // 2. Reject acknowledging future version (e.g. version 5 when item version is 3)
        await expect(
            service.acknowledgeRead(recipient, {
                items: [{ id: myItem.id, version: 5 }],
            }),
        ).rejects.toThrow(BadRequestException);

        // 3. Acknowledge version 2 (advances readVersion from 1 to 2)
        const ack1 = await service.acknowledgeRead(recipient, {
            items: [{ id: myItem.id, version: 2 }],
        });
        expect(ack1.success).toBe(true);

        let reloaded = await inboxRepo.findOneByOrFail({ id: myItem.id });
        expect(reloaded.readVersion).toBe(2);

        // 4. Repeated acknowledgement with older/same version (version 1) is monotonic (stays 2)
        await service.acknowledgeRead(recipient, {
            items: [{ id: myItem.id, version: 1 }],
        });
        reloaded = await inboxRepo.findOneByOrFail({ id: myItem.id });
        expect(reloaded.readVersion).toBe(2);

        // 5. Acknowledge version 3, now item is fully read (readVersion == version)
        await service.acknowledgeRead(recipient, {
            items: [{ id: myItem.id, version: 3 }],
        });
        reloaded = await inboxRepo.findOneByOrFail({ id: myItem.id });
        expect(reloaded.readVersion).toBe(3);

        const listFullyRead = await service.findAll(recipient, { limit: 10 });
        expect(listFullyRead.unreadCount).toBe(0);

        // 6. Concurrent new event bumps version to 4
        await inboxRepo.update({ id: myItem.id }, { version: 4 });

        // Item is now unread again!
        const listNewEvent = await service.findAll(recipient, { limit: 10 });
        expect(listNewEvent.unreadCount).toBe(1);
    });

    it("verifies reads do not consume notifications and two readers do not conflict", async () => {
        const recipient = randomUUID();
        await createProfile(recipient, `reader_${recipient.slice(0, 6)}`);

        const inboxRepo = dataSource.getRepository(NotificationInbox);
        await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `shared:${randomUUID()}`,
                type: "profile.followed",
                actorIds: [],
                actorCount: 1,
                eventCount: 1,
                lastEventAt: new Date(),
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // Device 1 reads
        const read1 = await service.findAll(recipient, { limit: 10 });
        expect(read1.unreadCount).toBe(1);
        expect(read1.data[0].readVersion).toBe(0);

        // Device 2 reads
        const read2 = await service.findAll(recipient, { limit: 10 });
        expect(read2.unreadCount).toBe(1);
        expect(read2.data[0].readVersion).toBe(0);

        // Neither read consumed the notification!
        const read3 = await service.findAll(recipient, { limit: 10 });
        expect(read3.unreadCount).toBe(1);
    });

    it("contract fixture: renders every supported notification item in a single response", async () => {
        const recipient = randomUUID();
        const actor = randomUUID();
        await createProfile(recipient, `cr_${recipient.slice(0, 8)}`);
        await createProfile(actor, `ca_${actor.slice(0, 8)}`);

        const inboxRepo = dataSource.getRepository(NotificationInbox);

        const postId = randomUUID();
        const commentId = randomUUID();
        const replyId = randomUUID();
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Contract root')",
            [postId, recipient],
        );
        await dataSource.query(
            "INSERT INTO post_comment (id, profileUserId, postId, content) VALUES (?, ?, ?, 'Comment')",
            [commentId, recipient, postId],
        );
        await dataSource.query(
            "INSERT INTO post_comment (id, profileUserId, postId, childOfId, content) VALUES (?, ?, ?, ?, 'Reply')",
            [replyId, recipient, postId, commentId],
        );

        // 1. content.liked
        await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `like:${randomUUID()}`,
                type: "content.liked",
                actorIds: [actor],
                actorCount: 1,
                eventCount: 5,
                preview: { text: "5 people liked your post" },
                rootType: "post",
                rootId: postId,
                target: { type: "post", id: postId },
                lastEventAt: new Date(Date.now() - 5000),
                version: 5,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // 2. comment.created
        await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `comment:${randomUUID()}`,
                type: "comment.created",
                rootType: "post",
                rootId: postId,
                actorIds: [actor],
                actorCount: 1,
                eventCount: 1,
                preview: { text: "Great post!" },
                target: {
                    type: "post",
                    id: postId,
                    focusId: commentId,
                },
                lastEventAt: new Date(Date.now() - 4000),
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // 3. comment.replied
        await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `reply:${randomUUID()}`,
                type: "comment.replied",
                rootType: "post",
                rootId: postId,
                subjectType: "comment",
                subjectId: commentId,
                actorIds: [actor],
                actorCount: 1,
                eventCount: 1,
                preview: { text: "I agree with you" },
                target: {
                    type: "post",
                    id: postId,
                    focusId: replyId,
                },
                lastEventAt: new Date(Date.now() - 3000),
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // 4. profile.followed
        await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `follow:${randomUUID()}`,
                type: "profile.followed",
                actorIds: [actor],
                actorCount: 1,
                eventCount: 1,
                preview: { text: "Started following you" },
                target: { type: "profile", id: actor },
                lastEventAt: new Date(Date.now() - 2000),
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // 5. import.discovery-completed
        await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `import:${randomUUID()}`,
                type: "import.discovery-completed",
                actorIds: [],
                actorCount: 0,
                eventCount: 1,
                preview: {
                    provider: "steam",
                    gameCount: 15,
                    importedCount: 12,
                    skippedCount: 3,
                    failedCount: 0,
                    gameSample: [{ id: 1, title: "Portal 2" }],
                },
                target: { type: "importer", id: "99", provider: "steam" },
                lastEventAt: new Date(Date.now() - 1000),
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        // 6. moderation.applied
        await inboxRepo.save(
            inboxRepo.create({
                recipientUserId: recipient,
                groupKey: `moderation:${randomUUID()}`,
                type: "moderation.applied",
                actorIds: [],
                actorCount: 0,
                eventCount: 1,
                preview: {
                    text: "Moderation notice: alert",
                    action: "alert",
                    reason: "Inappropriate language",
                },
                target: { type: "profile", id: recipient },
                lastEventAt: new Date(),
                version: 1,
                readVersion: 0,
                isVisible: true,
                isRedacted: false,
            }),
        );

        const entryId = randomUUID(),
            reviewId = randomUUID(),
            activityId = randomUUID();
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            recipient,
        ]);
        await dataSource.query(
            "INSERT INTO collection_entry (id, libraryUserId, gameId) VALUES (?, ?, 1)",
            [entryId, recipient],
        );
        await dataSource.query(
            "INSERT INTO review (id, profileUserId, collectionEntryId, gameId, rating) VALUES (?, ?, ?, 1, 5)",
            [reviewId, recipient, entryId],
        );
        await dataSource.query(
            "INSERT INTO activity (id, profileUserId, type, postId) VALUES (?, ?, 'post', ?)",
            [activityId, recipient, postId],
        );
        for (const [rootType, rootId, target] of [
            ["review", reviewId, { type: "review", id: reviewId }],
            [
                "activity",
                activityId,
                {
                    type: "activity",
                    id: activityId,
                    activityType: "post",
                    content: { type: "post", id: postId },
                    game: {
                        id: 1,
                        name: "Notification fixture",
                        slug: "notification-fixture",
                    },
                },
            ],
        ] as const) {
            await inboxRepo.save({
                recipientUserId: recipient,
                groupKey: randomUUID(),
                type: "content.liked",
                rootType,
                rootId,
                actorIds: [actor],
                actorCount: 1,
                eventCount: 1,
                preview: { text: "Liked your content" },
                target,
                lastEventAt: new Date(),
                version: 1,
                readVersion: 0,
            });
        }
        const response = await service.findAll(recipient, { limit: 10 });
        expect(response.data).toHaveLength(8);
        expect(response.unreadCount).toBe(8);

        const types = response.data.map((d) => d.type);
        expect(types).toContain("content.liked");
        expect(types).toContain("comment.created");
        expect(types).toContain("comment.replied");
        expect(types).toContain("profile.followed");
        expect(types).toContain("import.discovery-completed");
        expect(types).toContain("moderation.applied");

        // Verify all 6 have valid typed targets, valid pagination, and are ready to render
        for (const item of response.data) {
            expect(item.id).toBeGreaterThan(0);
            expect(item.version).toBeGreaterThanOrEqual(1);
            expect(item.lastEventAt).toBeInstanceOf(Date);
            expect(item.target).toBeDefined();
        }
    });
});
