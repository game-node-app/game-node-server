import "reflect-metadata";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import {
    NotificationsProjectorService,
    extractSafePlainText,
} from "./notifications-projector.service";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";

describe("NotificationsProjectorService", () => {
    let dataSource: DataSource;
    let projector: NotificationsProjectorService;
    let relayService: NotificationsRelayService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();

        relayService = new NotificationsRelayService(
            dataSource,
            dataSource.getRepository(NotificationOutbox),
            { add: jest.fn() } as any,
        );
        projector = new NotificationsProjectorService(dataSource, relayService);
    });

    async function createMockProfile(userId: string) {
        const username = `u_${userId.slice(0, 16)}`;
        await dataSource.query(
            `INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt)
             VALUES (?, ?, NOW(), NOW())`,
            [userId, username],
        );
    }

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    it.each(["exception", "version", "payload"])(
        "records %s projection failures durably without partial contributions",
        async (failure) => {
            const repo = dataSource.getRepository(NotificationOutbox);
            const id = `failure-${randomUUID()}`;
            const token = randomUUID();
            await repo.save({
                id,
                eventType: "profile.followed",
                eventVersion: failure === "version" ? 2 : 1,
                occurredAt: new Date(),
                recipientUserId: randomUUID(),
                actorUserId: randomUUID(),
                payload: failure === "payload" ? {} : { followId: 1 },
                state: "processing",
                ownerToken: token,
                ownerExpiresAt: new Date(Date.now() + 30000),
                attempts: 1,
                nextAttemptAt: new Date(),
            });
            const resolver =
                failure === "exception"
                    ? jest
                          .spyOn(projector as any, "resolveEventDetails")
                          .mockRejectedValue(
                              new Error(
                                  "private source payload and credential",
                              ),
                          )
                    : null;
            try {
                expect(await projector.projectEvent(id, token)).toBe(false);
                expect(await repo.findOneByOrFail({ id })).toMatchObject({
                    state: failure === "exception" ? "pending" : "failed",
                    ownerToken: null,
                    lastError:
                        failure === "exception"
                            ? "delivery_failed"
                            : "invalid_event",
                });
                expect(
                    await dataSource
                        .getRepository(NotificationEvent)
                        .countBy({ eventId: id }),
                ).toBe(0);
            } finally {
                resolver?.mockRestore();
                await repo.delete({ id });
            }
        },
    );

    it("rolls back contributions when ownership expires during projection", async () => {
        const repo = dataSource.getRepository(NotificationOutbox);
        const id = randomUUID();
        const recipient = randomUUID();
        await repo.save({
            id,
            eventType: "profile.followed",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: recipient,
            actorUserId: randomUUID(),
            payload: { followId: 1 },
            state: "processing",
            ownerToken: "expires-during-work",
            ownerExpiresAt: new Date(Date.now() + 30000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        const original = (projector as any).resolveEventDetails.bind(projector);
        const resolver = jest
            .spyOn(projector as any, "resolveEventDetails")
            .mockImplementation(async (...args: any[]) => {
                const result = await original(...args);
                await args[0].update(
                    NotificationOutbox,
                    { id },
                    { ownerExpiresAt: new Date(Date.now() - 1000) },
                );
                return result;
            });
        try {
            expect(
                await projector.projectEvent(id, "expires-during-work"),
            ).toBe(false);
            expect(await repo.findOneByOrFail({ id })).toMatchObject({
                state: "pending",
                ownerToken: null,
            });
            expect(
                await dataSource
                    .getRepository(NotificationEvent)
                    .countBy({ eventId: id }),
            ).toBe(0);
            expect(
                await dataSource
                    .getRepository(NotificationInbox)
                    .countBy({ recipientUserId: recipient }),
            ).toBe(0);
        } finally {
            resolver.mockRestore();
            await repo.delete({ id });
        }
    });

    it("serializes duplicate workers with an operator rearm and preserves acknowledged contributions", async () => {
        const repo = dataSource.getRepository(NotificationOutbox);
        const id = randomUUID();
        const recipient = randomUUID();
        await repo.save({
            id,
            eventType: "profile.followed",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: recipient,
            actorUserId: randomUUID(),
            payload: { followId: 1 },
            state: "processing",
            ownerToken: "original",
            ownerExpiresAt: new Date(Date.now() + 30000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        let release!: () => void;
        const resume = new Promise<void>((resolve) => {
            release = resolve;
        });
        const original = (projector as any).resolveEventDetails.bind(projector);
        const resolver = jest
            .spyOn(projector as any, "resolveEventDetails")
            .mockImplementationOnce(async (...args: any[]) => {
                entered();
                await resume;
                return original(...args);
            });
        try {
            const first = projector.projectEvent(id, "original");
            await started;
            const rearm = relayService.rearmEvent(id);
            release();
            expect(await first).toBe(true);
            expect(await rearm).toBe(true);
            resolver.mockRestore();
            expect(await projector.projectEvent(id, "original")).toBe(false);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const inbox = await inboxRepo.findOneByOrFail({
                recipientUserId: recipient,
            });
            await inboxRepo.update({ id: inbox.id }, { readVersion: 1 });
            await repo.update(
                { id },
                {
                    state: "processing",
                    ownerToken: "replacement",
                    ownerExpiresAt: new Date(Date.now() + 30000),
                },
            );
            const results = await Promise.all([
                projector.projectEvent(id, "replacement"),
                projector.projectEvent(id, "replacement"),
            ]);
            expect(results.filter(Boolean)).toHaveLength(1);
            expect(
                await inboxRepo.findOneByOrFail({ id: inbox.id }),
            ).toMatchObject({ eventCount: 1, version: 1, readVersion: 1 });
        } finally {
            release();
            resolver.mockRestore();
            await repo.delete({ id });
            await dataSource
                .getRepository(NotificationEvent)
                .delete({ eventId: id });
            await dataSource
                .getRepository(NotificationInbox)
                .delete({ recipientUserId: recipient });
        }
    });

    it("serializes concurrent same-actor comments and orders timestamp ties by event identity", async () => {
        const repo = dataSource.getRepository(NotificationOutbox);
        const owner = randomUUID();
        const actor = randomUUID();
        const post = randomUUID();
        await createMockProfile(owner);
        await createMockProfile(actor);
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Race')",
            [post, owner],
        );
        const events: string[] = [];
        const comments: string[] = [];
        const at = new Date("2026-10-25T12:00:00.123Z");
        try {
            for (const prefix of ["z", "a"]) {
                const commentId = randomUUID();
                const id = `${prefix}-${randomUUID()}`;
                comments.push(commentId);
                events.push(id);
                await dataSource.query(
                    "INSERT INTO post_comment (id, profileUserId, postId, content) VALUES (?, ?, ?, ?)",
                    [commentId, actor, post, prefix],
                );
                await repo.save({
                    id,
                    eventType: "comment.created",
                    eventVersion: 1,
                    occurredAt: at,
                    recipientUserId: owner,
                    actorUserId: actor,
                    payload: { commentId, rootType: "post", rootId: post },
                    state: "processing",
                    ownerToken: id,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                });
            }
            await Promise.all(
                events.map((id) => projector.projectEvent(id, id)),
            );
            // Any deadlock loser remains a durable retry; finish it with a new owned attempt.
            for (const id of events) {
                if (
                    (await repo.findOneByOrFail({ id })).state !== "completed"
                ) {
                    await repo.update(
                        { id },
                        {
                            state: "processing",
                            ownerToken: id,
                            ownerExpiresAt: new Date(Date.now() + 30000),
                        },
                    );
                    expect(await projector.projectEvent(id, id)).toBe(true);
                }
            }
            expect(
                await dataSource
                    .getRepository(NotificationInbox)
                    .findOneByOrFail({ recipientUserId: owner }),
            ).toMatchObject({
                eventCount: 2,
                actorCount: 1,
                actorIds: [actor],
                version: 2,
                preview: { text: "z" },
                target: { focusId: comments[0] },
                lastEventAt: at,
            });
        } finally {
            for (const id of events) await repo.delete({ id });
            await dataSource
                .getRepository(NotificationEvent)
                .delete({ recipientUserId: owner });
            await dataSource
                .getRepository(NotificationInbox)
                .delete({ recipientUserId: owner });
            await dataSource.query("DELETE FROM post WHERE id = ?", [post]);
        }
    });

    describe("safe preview extraction", () => {
        it("truncates plain text at 240 characters", () => {
            const longText = "a".repeat(300);
            const result = extractSafePlainText(longText);
            expect(result.length).toBe(240);
        });

        it("replaces HTML tags with generic summary", () => {
            const html = "<p>Hello <script>alert('xss')</script></p>";
            const result = extractSafePlainText(html, "Shared a comment");
            expect(result).toBe("Shared a comment");
            expect(result).not.toContain("<");
        });
    });

    describe("event handlers & projection", () => {
        it("handles content.liked on a post and verifies trusted recipient", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const eventRepo = dataSource.getRepository(NotificationEvent);
            const inboxRepo = dataSource.getRepository(NotificationInbox);

            const postId = randomUUID();
            const postOwner = randomUUID();
            const liker = randomUUID();
            const eventId = `like-ev-${randomUUID()}`;
            const token = `token-${randomUUID()}`;

            await createMockProfile(postOwner);
            await createMockProfile(liker);

            // Insert a mock post row into post table
            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Great post', NOW(), NOW())`,
                [postId, postOwner],
            );

            // Insert outbox event for like
            await outboxRepo.save(
                outboxRepo.create({
                    id: eventId,
                    eventType: "content.liked",
                    eventVersion: 1,
                    occurredAt: new Date("2026-10-25T12:00:00Z"),
                    actorUserId: liker,
                    payload: {
                        likeId: 101,
                        subjectType: "post",
                        subjectId: postId,
                    },
                    state: "processing",
                    ownerToken: token,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );

            const success = await projector.projectEvent(eventId, token);
            expect(success).toBe(true);

            // Verify outbox completed
            const outbox = await outboxRepo.findOneBy({ id: eventId });
            expect(outbox?.state).toBe("completed");

            // Verify notification_event
            const event = await eventRepo.findOneBy({ eventId });
            expect(event).toBeDefined();
            expect(event?.recipientUserId).toBe(postOwner);
            expect(event?.actorUserId).toBe(liker);
            expect(event?.target?.type).toBe("post");
            expect(event?.target?.id).toBe(postId);

            // Verify notification_inbox
            const inbox = await inboxRepo.findOneBy({
                recipientUserId: postOwner,
                groupKey: event?.groupKey,
            });
            expect(inbox).toBeDefined();
            expect(inbox?.eventCount).toBe(1);
            expect(inbox?.actorCount).toBe(1);
            expect(inbox?.actorIds).toEqual([liker]);
            expect(inbox?.version).toBe(1);
            expect(inbox?.readVersion).toBe(0);

            // Cleanup
            await eventRepo.delete({ eventId });
            await inboxRepo.delete({ id: inbox!.id });
            await outboxRepo.delete({ id: eventId });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("suppresses self-notifications without failing the action", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const user = randomUUID();
            const postId = randomUUID();
            const eventId = `self-ev-${randomUUID()}`;
            const token = `token-${randomUUID()}`;

            await createMockProfile(user);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'My own post', NOW(), NOW())`,
                [postId, user],
            );

            await outboxRepo.save(
                outboxRepo.create({
                    id: eventId,
                    eventType: "content.liked",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    actorUserId: user, // same user!
                    payload: {
                        likeId: 102,
                        subjectType: "post",
                        subjectId: postId,
                    },
                    state: "processing",
                    ownerToken: token,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );

            const result = await projector.projectEvent(eventId, token);
            expect(result).toBe(true);

            const outbox = await outboxRepo.findOneBy({ id: eventId });
            expect(outbox?.state).toBe("suppressed");
            expect(outbox?.lastError).toBe("self_notification");

            // Cleanup
            await outboxRepo.delete({ id: eventId });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("suppresses game likes without a human recipient", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const eventId = `game-like-${randomUUID()}`;
            const token = `token-${randomUUID()}`;

            await outboxRepo.save(
                outboxRepo.create({
                    id: eventId,
                    eventType: "content.liked",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    actorUserId: "user-1",
                    payload: {
                        likeId: 103,
                        subjectType: "game",
                        subjectId: "12345",
                    },
                    state: "processing",
                    ownerToken: token,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );

            await projector.projectEvent(eventId, token);
            const outbox = await outboxRepo.findOneBy({ id: eventId });
            expect(outbox?.state).toBe("suppressed");
            expect(outbox?.lastError).toBe("game_like_no_recipient");

            await outboxRepo.delete({ id: eventId });
        });

        it("handles import.discovery-completed with system actor and bounded preview", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const recipient = `importer-user-${randomUUID()}`;
            const eventId = `imp-ev-${randomUUID()}`;
            const token = `token-${randomUUID()}`;

            await outboxRepo.save(
                outboxRepo.create({
                    id: eventId,
                    eventType: "import.discovery-completed",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    recipientUserId: recipient,
                    payload: {
                        discoveryResultId: 55,
                        provider: "steam",
                        gameCount: 10,
                        importedCount: 8,
                        skippedCount: 1,
                        failedCount: 1,
                        gameSample: [
                            { id: 1, title: "Game 1" },
                            { id: 2, title: "Game 2" },
                            { id: 3, title: "Game 3" },
                        ],
                    },
                    state: "processing",
                    ownerToken: token,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );

            await projector.projectEvent(eventId, token);

            const outbox = await outboxRepo.findOneBy({ id: eventId });
            expect(outbox?.state).toBe("completed");

            const inbox = await inboxRepo.findOneBy({
                recipientUserId: recipient,
                type: "import.discovery-completed",
            });
            expect(inbox).toBeDefined();
            expect(inbox?.preview?.gameSample.length).toBe(3); // bounded to 3!
            expect(inbox?.actorIds).toEqual([]); // system actor

            await inboxRepo.delete({ id: inbox!.id });
            await outboxRepo.delete({ id: eventId });
        });

        it("handles moderation.applied with system actor without privileged fields", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const recipient = `mod-user-${randomUUID()}`;
            const eventId = `mod-ev-${randomUUID()}`;
            const token = `token-${randomUUID()}`;

            await outboxRepo.save(
                outboxRepo.create({
                    id: eventId,
                    eventType: "moderation.applied",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    recipientUserId: recipient,
                    payload: {
                        action: "alert",
                        safeReason: "Violated community guidelines",
                        reportId: 999,
                        // Note: internal reporter data or notes are not in payload
                    },
                    state: "processing",
                    ownerToken: token,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );

            await projector.projectEvent(eventId, token);

            const inbox = await inboxRepo.findOneBy({
                recipientUserId: recipient,
                type: "moderation.applied",
            });
            expect(inbox).toBeDefined();
            expect(inbox?.actorIds).toEqual([]);
            expect(inbox?.preview?.text).toBe("Moderation notice: alert");
            expect(inbox?.preview?.reason).toBe(
                "Violated community guidelines",
            );
            expect((inbox?.preview as any)?.reporterId).toBeUndefined();

            await inboxRepo.delete({ id: inbox!.id });
            await outboxRepo.delete({ id: eventId });
        });

        it("aggregates events on the same UTC day, caps actorIds at 3, and distinguishes distinct actors", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const eventRepo = dataSource.getRepository(NotificationEvent);

            const postId = randomUUID();
            const postOwner = randomUUID();

            await createMockProfile(postOwner);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Target post', NOW(), NOW())`,
                [postId, postOwner],
            );

            const dateStr = "2026-10-25T10:00:00Z";

            // Add 4 different actors liking the post on the same UTC day
            const actors = [
                randomUUID(),
                randomUUID(),
                randomUUID(),
                randomUUID(),
            ];
            for (const actor of actors) {
                await createMockProfile(actor);
            }
            for (let i = 0; i < actors.length; i++) {
                const eventId = `agg-ev-${i}-${randomUUID()}`;
                const token = `tok-${i}`;
                await outboxRepo.save(
                    outboxRepo.create({
                        id: eventId,
                        eventType: "content.liked",
                        eventVersion: 1,
                        occurredAt: new Date(dateStr),
                        actorUserId: actors[i],
                        payload: {
                            likeId: 200 + i,
                            subjectType: "post",
                            subjectId: postId,
                        },
                        state: "processing",
                        ownerToken: token,
                        ownerExpiresAt: new Date(Date.now() + 30000),
                        attempts: 1,
                        nextAttemptAt: new Date(),
                    }),
                );
                await projector.projectEvent(eventId, token);
            }

            // Also repeat actors[0] (another event, same actor)
            const repeatEventId = `agg-ev-repeat-${randomUUID()}`;
            const repeatToken = "tok-repeat";
            await outboxRepo.save(
                outboxRepo.create({
                    id: repeatEventId,
                    eventType: "content.liked",
                    eventVersion: 1,
                    occurredAt: new Date(dateStr),
                    actorUserId: actors[0],
                    payload: {
                        likeId: 299,
                        subjectType: "post",
                        subjectId: postId,
                    },
                    state: "processing",
                    ownerToken: repeatToken,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );
            await projector.projectEvent(repeatEventId, repeatToken);

            const inboxes = await inboxRepo.findBy({
                recipientUserId: postOwner,
            });
            expect(inboxes.length).toBe(1); // One group for the day!
            const group = inboxes[0];

            expect(group.eventCount).toBe(5); // 5 total events
            expect(group.actorCount).toBe(4); // 4 distinct actors
            expect(group.actorIds.length).toBe(3); // capped at 3
            expect(group.version).toBe(5);

            // Cleanup
            await eventRepo.delete({ recipientUserId: postOwner });
            await inboxRepo.delete({ id: group.id });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("creates a separate group on the next UTC calendar day", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const eventRepo = dataSource.getRepository(NotificationEvent);

            const postId = randomUUID();
            const postOwner = randomUUID();
            const actorA = randomUUID();
            const actorB = randomUUID();

            await createMockProfile(postOwner);
            await createMockProfile(actorA);
            await createMockProfile(actorB);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Post for day test', NOW(), NOW())`,
                [postId, postOwner],
            );

            // Day 1: 2026-10-25
            const ev1 = `day-ev-1-${randomUUID()}`;
            const tok1 = "tok-d1";
            await outboxRepo.save(
                outboxRepo.create({
                    id: ev1,
                    eventType: "content.liked",
                    eventVersion: 1,
                    occurredAt: new Date("2026-10-25T14:00:00Z"),
                    actorUserId: actorA,
                    payload: {
                        likeId: 301,
                        subjectType: "post",
                        subjectId: postId,
                    },
                    state: "processing",
                    ownerToken: tok1,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );
            await projector.projectEvent(ev1, tok1);

            // Day 2: 2026-10-26
            const ev2 = `day-ev-2-${randomUUID()}`;
            const tok2 = "tok-d2";
            await outboxRepo.save(
                outboxRepo.create({
                    id: ev2,
                    eventType: "content.liked",
                    eventVersion: 1,
                    occurredAt: new Date("2026-10-26T08:00:00Z"),
                    actorUserId: actorB,
                    payload: {
                        likeId: 302,
                        subjectType: "post",
                        subjectId: postId,
                    },
                    state: "processing",
                    ownerToken: tok2,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );
            await projector.projectEvent(ev2, tok2);

            const inboxes = await inboxRepo.findBy({
                recipientUserId: postOwner,
            });
            expect(inboxes.length).toBe(2); // Two distinct day groups!

            // Cleanup
            await eventRepo.delete({ recipientUserId: postOwner });
            await inboxRepo.delete({ recipientUserId: postOwner });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("preserves read state and counts on duplicate worker processing (idempotency)", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const eventRepo = dataSource.getRepository(NotificationEvent);

            const postId = randomUUID();
            const postOwner = randomUUID();
            const actorX = randomUUID();

            await createMockProfile(postOwner);
            await createMockProfile(actorX);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Idempotency test', NOW(), NOW())`,
                [postId, postOwner],
            );

            const eventId = `idem-ev-${randomUUID()}`;
            const token = "tok-idem";
            await outboxRepo.save(
                outboxRepo.create({
                    id: eventId,
                    eventType: "content.liked",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    actorUserId: actorX,
                    payload: {
                        likeId: 401,
                        subjectType: "post",
                        subjectId: postId,
                    },
                    state: "processing",
                    ownerToken: token,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );

            // First run
            await projector.projectEvent(eventId, token);

            // Set readVersion = 1 on inbox simulating user acknowledged it
            await inboxRepo.update(
                { recipientUserId: postOwner },
                { readVersion: 1 },
            );

            // Simulate duplicate worker or retry: set outbox back to processing with new token
            const retryToken = "tok-retry";
            await outboxRepo.update(
                { id: eventId },
                { state: "processing", ownerToken: retryToken },
            );

            // Second run
            await projector.projectEvent(eventId, retryToken);

            const inbox = await inboxRepo.findOneBy({
                recipientUserId: postOwner,
            });
            expect(inbox?.eventCount).toBe(1); // not incremented!
            expect(inbox?.version).toBe(1); // not incremented!
            expect(inbox?.readVersion).toBe(1); // read state preserved!

            // Cleanup
            await eventRepo.delete({ recipientUserId: postOwner });
            await inboxRepo.delete({ id: inbox!.id });
            await outboxRepo.delete({ id: eventId });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("handles comment.created and comment.replied with safe preview and typed target", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const eventRepo = dataSource.getRepository(NotificationEvent);

            const postId = randomUUID();
            const postOwner = randomUUID();
            const commenter = randomUUID();
            const replier = randomUUID();

            await createMockProfile(postOwner);
            await createMockProfile(commenter);
            await createMockProfile(replier);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Post for comments', NOW(), NOW())`,
                [postId, postOwner],
            );

            const commentId = randomUUID();
            await dataSource.query(
                `INSERT INTO post_comment (id, profileUserId, postId, content, createdAt, updatedAt)
                 VALUES (?, ?, ?, 'Nice post!', NOW(), NOW())`,
                [commentId, commenter, postId],
            );

            // Project comment.created
            const evComment = `ev-comm-${randomUUID()}`;
            const tokComment = "tok-comm";
            await outboxRepo.save(
                outboxRepo.create({
                    id: evComment,
                    eventType: "comment.created",
                    eventVersion: 1,
                    occurredAt: new Date("2026-10-25T11:00:00Z"),
                    actorUserId: commenter,
                    payload: { commentId, rootType: "post", rootId: postId },
                    state: "processing",
                    ownerToken: tokComment,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );
            await projector.projectEvent(evComment, tokComment);

            const inbox1 = await inboxRepo.findOneBy({
                recipientUserId: postOwner,
            });
            expect(inbox1?.type).toBe("comment.created");
            expect(inbox1?.preview?.text).toBe("Nice post!");
            expect(inbox1?.target?.type).toBe("post");
            expect(inbox1?.target?.id).toBe(postId);
            expect(inbox1?.target?.focusId).toBe(commentId);

            // Create reply comment
            const replyId = randomUUID();
            await dataSource.query(
                `INSERT INTO post_comment (id, profileUserId, postId, childOfId, content, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, 'Thanks!', NOW(), NOW())`,
                [replyId, replier, postId, commentId],
            );

            // Project comment.replied
            const evReply = `ev-reply-${randomUUID()}`;
            const tokReply = "tok-reply";
            await outboxRepo.save(
                outboxRepo.create({
                    id: evReply,
                    eventType: "comment.replied",
                    eventVersion: 1,
                    occurredAt: new Date("2026-10-25T11:05:00Z"),
                    actorUserId: replier,
                    payload: {
                        commentId: replyId,
                        parentCommentId: commentId,
                        rootType: "post",
                        rootId: postId,
                    },
                    state: "processing",
                    ownerToken: tokReply,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );
            await projector.projectEvent(evReply, tokReply);

            const inboxReply = await inboxRepo.findOneBy({
                recipientUserId: commenter,
            });
            expect(inboxReply?.type).toBe("comment.replied");
            expect(inboxReply?.preview?.text).toBe("Thanks!");
            expect(inboxReply?.target?.focusId).toBe(replyId);

            // Cleanup
            await eventRepo.delete({ eventId: evComment });
            await eventRepo.delete({ eventId: evReply });
            await inboxRepo.delete({ recipientUserId: postOwner });
            await inboxRepo.delete({ recipientUserId: commenter });
            await outboxRepo.delete({ id: evComment });
            await outboxRepo.delete({ id: evReply });
            await dataSource.query(
                `DELETE FROM post_comment WHERE id IN (?, ?)`,
                [commentId, replyId],
            );
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("handles profile.followed with recipient resolution", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const eventRepo = dataSource.getRepository(NotificationEvent);

            const follower = randomUUID();
            const followed = randomUUID();
            await createMockProfile(follower);
            await createMockProfile(followed);

            const followRes = await dataSource.query(
                `INSERT INTO user_follow (followerUserId, followedUserId, createdAt, updatedAt)
                 VALUES (?, ?, NOW(), NOW())`,
                [follower, followed],
            );
            const followId = followRes.insertId;

            const evFollow = `ev-fol-${randomUUID()}`;
            const tokFollow = "tok-fol";
            await outboxRepo.save(
                outboxRepo.create({
                    id: evFollow,
                    eventType: "profile.followed",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    actorUserId: follower,
                    payload: { followId },
                    state: "processing",
                    ownerToken: tokFollow,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );
            await projector.projectEvent(evFollow, tokFollow);

            const inbox = await inboxRepo.findOneBy({
                recipientUserId: followed,
            });
            expect(inbox?.type).toBe("profile.followed");
            expect(inbox?.target?.type).toBe("profile");
            expect(inbox?.target?.id).toBe(follower);

            // Cleanup
            await eventRepo.delete({ eventId: evFollow });
            await inboxRepo.delete({ recipientUserId: followed });
            await outboxRepo.delete({ id: evFollow });
            await dataSource.query(`DELETE FROM user_follow WHERE id = ?`, [
                followId,
            ]);
        });

        it("handles more than 20 contributions to one group and preserves latest ordering", async () => {
            const outboxRepo = dataSource.getRepository(NotificationOutbox);
            const inboxRepo = dataSource.getRepository(NotificationInbox);
            const eventRepo = dataSource.getRepository(NotificationEvent);

            const postId = randomUUID();
            const postOwner = randomUUID();
            await createMockProfile(postOwner);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Large group post', NOW(), NOW())`,
                [postId, postOwner],
            );

            const dateStr = "2026-10-25T15:00:00Z";
            const eventIds: string[] = [];

            // Add 25 events to this group
            for (let i = 0; i < 25; i++) {
                const actorId = randomUUID();
                await createMockProfile(actorId);
                const evId = `mass-ev-${i}-${randomUUID()}`;
                eventIds.push(evId);
                const tok = `tok-mass-${i}`;
                await outboxRepo.save(
                    outboxRepo.create({
                        id: evId,
                        eventType: "content.liked",
                        eventVersion: 1,
                        occurredAt: new Date(
                            new Date(dateStr).getTime() + i * 1000,
                        ),
                        actorUserId: actorId,
                        payload: {
                            likeId: 500 + i,
                            subjectType: "post",
                            subjectId: postId,
                        },
                        state: "processing",
                        ownerToken: tok,
                        ownerExpiresAt: new Date(Date.now() + 30000),
                        attempts: 1,
                        nextAttemptAt: new Date(),
                    }),
                );
                await projector.projectEvent(evId, tok);
            }

            const inboxes = await inboxRepo.findBy({
                recipientUserId: postOwner,
            });
            expect(inboxes.length).toBe(1); // One group for all 25!
            expect(inboxes[0].eventCount).toBe(25);
            expect(inboxes[0].actorCount).toBe(25);
            expect(inboxes[0].version).toBe(25);

            // Now insert a late older event (occurred before latest event in group)
            const olderEv = `older-ev-${randomUUID()}`;
            const olderTok = "tok-older";
            const olderActor = randomUUID();
            await createMockProfile(olderActor);
            await outboxRepo.save(
                outboxRepo.create({
                    id: olderEv,
                    eventType: "content.liked",
                    eventVersion: 1,
                    occurredAt: new Date(new Date(dateStr).getTime() - 10000), // 10 seconds older!
                    actorUserId: olderActor,
                    payload: {
                        likeId: 999,
                        subjectType: "post",
                        subjectId: postId,
                    },
                    state: "processing",
                    ownerToken: olderTok,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                    attempts: 1,
                    nextAttemptAt: new Date(),
                }),
            );
            await projector.projectEvent(olderEv, olderTok);

            const updatedInbox = await inboxRepo.findOneBy({
                recipientUserId: postOwner,
            });
            expect(updatedInbox?.eventCount).toBe(26);
            // The lastEventAt was NOT replaced by the older event!
            expect(updatedInbox?.lastEventAt.getTime()).toBe(
                new Date(new Date(dateStr).getTime() + 24 * 1000).getTime(),
            );

            // Cleanup
            await eventRepo.delete({ recipientUserId: postOwner });
            await inboxRepo.delete({ recipientUserId: postOwner });
            await outboxRepo.delete({ id: olderEv });
            for (const id of eventIds) {
                await outboxRepo.delete({ id });
            }
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });
    });
});
