import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { NotificationsLifecycleService } from "./notifications-lifecycle.service";
import { NotificationsProjectorService } from "./notifications-projector.service";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { PostsService } from "../posts/posts.service";
import { PostsRepository } from "../posts/posts.repository";
import { CommentService } from "../comment/comment.service";
import { CommentSourceType } from "../comment/comment.constants";
import { CollectionsService } from "../collections/collections.service";
import { Collection } from "../collections/entities/collection.entity";
import { Post } from "../posts/entity/post.entity";
import { randomUUID } from "crypto";
import { NotificationsService } from "./notifications.service";
import { Profile } from "../profile/entities/profile.entity";
import { ProfileService } from "../profile/profile.service";
import { ProfileAvatar } from "../profile/entities/profile-avatar.entity";
import { ProfileBanner } from "../profile/entities/profile-banner.entity";

describe("Notifications lifecycle and access protection (Section 6)", () => {
    let dataSource: DataSource;
    let lifecycleService: NotificationsLifecycleService;
    let projectorService: NotificationsProjectorService;
    let postsService: PostsService;
    let commentService: CommentService;
    let collectionsService: CollectionsService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();

        lifecycleService = new NotificationsLifecycleService(
            dataSource.getRepository(NotificationInbox),
            dataSource.getRepository(NotificationEvent),
            dataSource,
        );

        const relayService = new NotificationsRelayService(
            dataSource,
            dataSource.getRepository(NotificationOutbox),
            { add: jest.fn() } as any,
        );

        projectorService = new NotificationsProjectorService(
            dataSource,
            relayService,
        );

        const postRepo = new PostsRepository(dataSource.manager);
        postsService = new PostsService(
            postRepo,
            {} as any,
            { register: jest.fn() } as any,
            lifecycleService,
        );

        commentService = new CommentService(
            dataSource,
            lifecycleService,
        );

        collectionsService = new CollectionsService(
            dataSource.getRepository(Collection),
            {} as any,
            {} as any,
            lifecycleService,
        );
    });

    afterAll(async () => {
        if (dataSource && dataSource.isInitialized) {
            await dataSource.destroy();
        }
    });

    async function createMockProfile(userId: string) {
        await dataSource.query(
            `INSERT INTO profile (userId, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE userId = userId`,
            [userId, `user_${userId.slice(0, 8)}`],
        );
    }

    async function activityFixture() {
        const owner = randomUUID(),
            actor = randomUUID(),
            collection = randomUUID(),
            entry = randomUUID(),
            activity = randomUUID();
        for (const user of [owner, actor]) await createMockProfile(user);
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            owner,
        ]);
        await dataSource.query(
            "INSERT INTO collection (id, libraryUserId, name, isPublic) VALUES (?, ?, 'Activity context', 1)",
            [collection, owner],
        );
        await dataSource.query(
            "INSERT INTO collection_entry (id, libraryUserId, gameId) VALUES (?, ?, 1)",
            [entry, owner],
        );
        await dataSource.query(
            "INSERT INTO collection_entry_collections_collection (collectionEntryId, collectionId, `order`, createdAt) VALUES (?, ?, 0, NOW())",
            [entry, collection],
        );
        await dataSource.query(
            "INSERT INTO activity (id, profileUserId, type, collectionId, collectionEntryId) VALUES (?, ?, 'collection_entry', ?, ?)",
            [activity, owner, collection, entry],
        );
        const event = await dataSource.getRepository(NotificationOutbox).save({
            id: randomUUID(),
            eventType: "content.liked",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: owner,
            actorUserId: actor,
            payload: {
                likeId: 1,
                subjectType: "activity",
                subjectId: activity,
            },
            state: "processing",
            ownerToken: "activity-fixture",
            ownerExpiresAt: new Date(Date.now() + 30000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        const inbox = new NotificationsService(
            dataSource.getRepository(NotificationInbox),
            dataSource.getRepository(Profile),
            dataSource,
        );
        return { owner, collection, activity, event, inbox };
    }

    it.each(["privacy_first", "projection_first"])(
        "coordinates collection privacy and projection on two connections: %s",
        async (order) => {
            const fixture = await activityFixture();
            let enter!: () => void, release!: () => void;
            const entered = new Promise<void>((resolve) => {
                enter = resolve;
            });
            const resume = new Promise<void>((resolve) => {
                release = resolve;
            });
            let spy: jest.SpyInstance;
            let first: Promise<unknown>, second: Promise<unknown>;
            if (order === "privacy_first") {
                const invalidate =
                    lifecycleService.invalidateCollection.bind(
                        lifecycleService,
                    );
                spy = jest
                    .spyOn(lifecycleService, "invalidateCollection")
                    .mockImplementation(async (...args) => {
                        enter();
                        await resume;
                        return invalidate(...args);
                    });
                first = collectionsService.update(
                    fixture.owner,
                    fixture.collection,
                    { isPublic: false },
                );
                await entered;
                second = projectorService.projectEvent(
                    fixture.event.id,
                    "activity-fixture",
                );
            } else {
                const resolve = (
                    projectorService as any
                ).resolveEventDetails.bind(projectorService);
                spy = jest
                    .spyOn(projectorService as any, "resolveEventDetails")
                    .mockImplementation(async (...args: any[]) => {
                        const result = await resolve(...args);
                        enter();
                        await resume;
                        return result;
                    });
                first = projectorService.projectEvent(
                    fixture.event.id,
                    "activity-fixture",
                );
                await entered;
                second = collectionsService.update(
                    fixture.owner,
                    fixture.collection,
                    { isPublic: false },
                );
            }
            try {
                release();
                await Promise.all([first, second]);
                expect(
                    await fixture.inbox.findAll(fixture.owner, { limit: 20 }),
                ).toMatchObject({ data: [], unreadCount: 0 });
                expect(
                    await dataSource
                        .getRepository(NotificationOutbox)
                        .findOneByOrFail({ id: fixture.event.id }),
                ).toMatchObject({
                    state:
                        order === "privacy_first" ? "suppressed" : "completed",
                });
            } finally {
                release();
                spy.mockRestore();
            }
        },
    );

    it("checks activity context for both items and unread counts after bypassed invalidation and source cascades", async () => {
        const fixture = await activityFixture();
        expect(
            await projectorService.projectEvent(
                fixture.event.id,
                "activity-fixture",
            ),
        ).toBe(true);
        const before = await fixture.inbox.findAll(fixture.owner, {
            limit: 20,
        });
        expect(before.data).toHaveLength(1);
        expect(before.data[0].target).toMatchObject({
            type: "activity",
            id: fixture.activity,
            content: { type: "collection_entry" },
            game: { id: 1, name: "Notification fixture" },
        });
        await dataSource.query(
            "UPDATE collection SET isPublic = 0 WHERE id = ?",
            [fixture.collection],
        );
        expect(
            await fixture.inbox.findAll(fixture.owner, { limit: 20 }),
        ).toMatchObject({ data: [], unreadCount: 0 });
        await dataSource.query("DELETE FROM profile WHERE userId = ?", [
            fixture.owner,
        ]);
        expect(
            await fixture.inbox.findAll(fixture.owner, { limit: 20 }),
        ).toMatchObject({ data: [], unreadCount: 0 });
    });

    it("hides owned inbox/source snapshots and suppresses pending intent in the profile deletion transaction", async () => {
        const fixture = await activityFixture();
        expect(
            await projectorService.projectEvent(
                fixture.event.id,
                "activity-fixture",
            ),
        ).toBe(true);
        const pending = await dataSource
            .getRepository(NotificationOutbox)
            .save({
                id: randomUUID(),
                eventType: "profile.followed",
                eventVersion: 1,
                recipientUserId: fixture.owner,
                actorUserId: null,
                occurredAt: new Date(),
                payload: { followId: 1 },
                state: "pending",
                nextAttemptAt: new Date(),
            });
        const profiles = new ProfileService(
            dataSource.getRepository(Profile),
            dataSource.getRepository(ProfileAvatar),
            dataSource.getRepository(ProfileBanner),
            {} as any,
            {} as any,
            lifecycleService,
        );
        await profiles.deleteByUserId(fixture.owner);
        expect(
            await dataSource
                .getRepository(NotificationInbox)
                .findOneByOrFail({ recipientUserId: fixture.owner }),
        ).toMatchObject({ isVisible: false });
        expect(
            await dataSource
                .getRepository(NotificationOutbox)
                .findOneByOrFail({ id: pending.id }),
        ).toMatchObject({
            state: "suppressed",
            lastError: "recipient_removed",
        });
        expect(
            await fixture.inbox.findAll(fixture.owner, { limit: 20 }),
        ).toMatchObject({ data: [], unreadCount: 0 });
    });

    async function createCommentNotification() {
        const owner = randomUUID();
        const actor = randomUUID();
        const outsider = randomUUID();
        const postId = randomUUID();
        for (const id of [owner, actor, outsider]) await createMockProfile(id);
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Deletion fixture')",
            [postId, owner],
        );
        const comment = await commentService.create(actor, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "Keep until an authorized deletion commits",
        });
        const outbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOneByOrFail({
                actorUserId: actor,
            });
        await dataSource.getRepository(NotificationOutbox).update(outbox.id, {
            state: "processing",
            ownerToken: "deletion-fixture",
            ownerExpiresAt: new Date(Date.now() + 60000),
        });
        await projectorService.projectEvent(outbox.id, "deletion-fixture");
        return { owner, actor, outsider, postId, comment };
    }

    it("does not hide another user's notifications after unauthorized deletion attempts", async () => {
        const { outsider, postId, comment } = await createCommentNotification();
        await postsService.delete(outsider, postId);
        await commentService.delete(outsider, comment.id, {
            sourceType: CommentSourceType.POST,
        });

        const post = await dataSource
            .getRepository(Post)
            .findOneByOrFail({ id: postId });
        expect(post.deletedAt).toBeNull();
        expect(
            await commentService.findOneById(
                CommentSourceType.POST,
                comment.id,
            ),
        ).not.toBeNull();
        const group = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({ rootId: postId });
        expect(group.isVisible).toBe(true);
        expect(group.preview?.text).toBe(
            "Keep until an authorized deletion commits",
        );
    });

    it.each(["deletion_first", "projection_first"])(
        "coordinates comment deletion and projection without resurrecting an excerpt: %s",
        async (order) => {
            const { owner, actor, postId } = await createCommentNotification();
            const comment = await commentService.create(actor, {
                sourceType: CommentSourceType.POST,
                sourceId: postId,
                content: "Removed during projection",
            });
            const repo = dataSource.getRepository(NotificationOutbox);
            const event = await repo.findOneByOrFail({
                actorUserId: actor,
                state: "pending",
            });
            await repo.update(
                { id: event.id },
                {
                    state: "processing",
                    ownerToken: "comment-race",
                    ownerExpiresAt: new Date(Date.now() + 30000),
                },
            );
            let enter!: () => void, release!: () => void;
            const entered = new Promise<void>((resolve) => {
                enter = resolve;
            });
            const resume = new Promise<void>((resolve) => {
                release = resolve;
            });
            let spy: jest.SpyInstance,
                first: Promise<unknown>,
                second: Promise<unknown>;
            if (order === "deletion_first") {
                const invalidate =
                    lifecycleService.invalidateComment.bind(lifecycleService);
                spy = jest
                    .spyOn(lifecycleService, "invalidateComment")
                    .mockImplementation(async (...args) => {
                        enter();
                        await resume;
                        return invalidate(...args);
                    });
                first = commentService.delete(actor, comment.id, {
                    sourceType: CommentSourceType.POST,
                });
                await entered;
                second = projectorService.projectEvent(
                    event.id,
                    "comment-race",
                );
            } else {
                const resolve = (
                    projectorService as any
                ).resolveEventDetails.bind(projectorService);
                spy = jest
                    .spyOn(projectorService as any, "resolveEventDetails")
                    .mockImplementation(async (...args: any[]) => {
                        const result = await resolve(...args);
                        enter();
                        await resume;
                        return result;
                    });
                first = projectorService.projectEvent(event.id, "comment-race");
                await entered;
                second = commentService.delete(actor, comment.id, {
                    sourceType: CommentSourceType.POST,
                });
            }
            try {
                release();
                await Promise.all([first, second]);
                const inbox = new NotificationsService(
                    dataSource.getRepository(NotificationInbox),
                    dataSource.getRepository(Profile),
                    dataSource,
                );
                const response = await inbox.findAll(owner, { limit: 20 });
                expect(JSON.stringify(response)).not.toContain(
                    "Removed during projection",
                );
                expect(response.data[0]?.target).not.toEqual(expect.objectContaining({ focusId: comment.id }));
                expect(
                    await repo.findOneByOrFail({ id: event.id }),
                ).toMatchObject({
                    state:
                        order === "deletion_first" ? "suppressed" : "completed",
                });
            } finally {
                release();
                spy.mockRestore();
            }
        },
    );

    it.each(["post", "comment"])(
        "rolls back %s deletion when notification invalidation fails",
        async (type) => {
            const { owner, actor, postId, comment } =
                await createCommentNotification();
            const failure = jest
                .spyOn(
                    lifecycleService,
                    type === "post" ? "invalidateContent" : "invalidateComment",
                )
                .mockRejectedValueOnce(new Error("invalidation unavailable"));
            try {
                await expect(
                    type === "post"
                        ? postsService.delete(owner, postId)
                        : commentService.delete(actor, comment.id, {
                              sourceType: CommentSourceType.POST,
                          }),
                ).rejects.toThrow("invalidation unavailable");

                expect(
                    await dataSource
                        .getRepository(Post)
                        .findOneBy({ id: postId }),
                ).not.toBeNull();
                expect(
                    await commentService.findOneById(
                        CommentSourceType.POST,
                        comment.id,
                    ),
                ).not.toBeNull();
                const group = await dataSource
                    .getRepository(NotificationInbox)
                    .findOneByOrFail({ rootId: postId });
                expect(group.isVisible).toBe(true);
            } finally {
                failure.mockRestore();
            }
        },
    );

    it("invalidates post inbox items on post soft-delete without touching unrelated items", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const post1 = randomUUID();
        const post2 = randomUUID();

        await createMockProfile(owner);
        await createMockProfile(actor);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post 1', NOW(), NOW()), (?, ?, 1, 'Post 2', NOW(), NOW())`,
            [post1, owner, post2, owner],
        );

        // Create comments on both posts
        await commentService.create(actor, {
            sourceType: CommentSourceType.POST,
            sourceId: post1,
            content: "Comment on post 1",
        });

        await commentService.create(actor, {
            sourceType: CommentSourceType.POST,
            sourceId: post2,
            content: "Comment on post 2",
        });

        // Project both outbox records
        const outboxItems = await dataSource
            .getRepository(NotificationOutbox)
            .find({
                where: { actorUserId: actor },
                order: { createdAt: "ASC" },
            });
        expect(outboxItems).toHaveLength(2);

        const outbox1 = outboxItems[0];
        outbox1.state = "processing";
        outbox1.ownerToken = "tok-1";
        outbox1.ownerExpiresAt = new Date(Date.now() + 60000);
        await dataSource.getRepository(NotificationOutbox).save(outbox1);
        await projectorService.projectEvent(outbox1.id, "tok-1");

        const outbox2 = outboxItems[1];
        outbox2.state = "processing";
        outbox2.ownerToken = "tok-2";
        outbox2.ownerExpiresAt = new Date(Date.now() + 60000);
        await dataSource.getRepository(NotificationOutbox).save(outbox2);
        await projectorService.projectEvent(outbox2.id, "tok-2");

        // Verify both are visible
        const inbox1 = await dataSource
            .getRepository(NotificationInbox)
            .findOneBy({ rootId: post1 });
        const inbox2 = await dataSource
            .getRepository(NotificationInbox)
            .findOneBy({ rootId: post2 });
        expect(inbox1?.isVisible).toBe(true);
        expect(inbox2?.isVisible).toBe(true);

        // Soft-delete post 1
        await postsService.delete(owner, post1);

        // Verify post 1 inbox item is invalidated, post 2 remains visible
        const check1 = await dataSource
            .getRepository(NotificationInbox)
            .findOneBy({ rootId: post1 });
        const check2 = await dataSource
            .getRepository(NotificationInbox)
            .findOneBy({ rootId: post2 });
        expect(check1?.isVisible).toBe(false);
        expect(check2?.isVisible).toBe(true);
    });

    it("suppresses events during projection if the source post is already soft-deleted", async () => {
        const owner = randomUUID();
        const actor = randomUUID();
        const postId = randomUUID();

        await createMockProfile(owner);
        await createMockProfile(actor);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post before race', NOW(), NOW())`,
            [postId, owner],
        );

        // Comment created
        await commentService.create(actor, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "Will race with deletion",
        });

        // Soft-delete post BEFORE projection occurs!
        await postsService.delete(owner, postId);

        // Now attempt projection
        const outbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOneOrFail({
                where: { actorUserId: actor },
            });
        outbox.state = "processing";
        outbox.ownerToken = "tok-race";
        outbox.ownerExpiresAt = new Date(Date.now() + 60000);
        await dataSource.getRepository(NotificationOutbox).save(outbox);

        await projectorService.projectEvent(outbox.id, "tok-race");

        // Outbox event was suppressed
        const finalOutbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOneBy({ id: outbox.id });
        expect(finalOutbox?.state).toBe("suppressed");

        // No visible inbox item was created
        const inbox = await dataSource
            .getRepository(NotificationInbox)
            .findOneBy({ rootId: postId });
        expect(inbox?.isVisible ?? false).toBe(false);
    });

    it("redacts deleted comment excerpt while preserving group contributions and read state", async () => {
        const owner = randomUUID();
        const commenter1 = randomUUID();
        const commenter2 = randomUUID();
        const postId = randomUUID();

        await createMockProfile(owner);
        await createMockProfile(commenter1);
        await createMockProfile(commenter2);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Group comment test', NOW(), NOW())`,
            [postId, owner],
        );

        // Comment 1
        const c1 = await commentService.create(commenter1, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "First comment",
        });

        const outbox1 = await dataSource
            .getRepository(NotificationOutbox)
            .findOneOrFail({
                where: { actorUserId: commenter1 },
            });
        outbox1.state = "processing";
        outbox1.ownerToken = "tok-c1";
        outbox1.ownerExpiresAt = new Date(Date.now() + 60000);
        await dataSource.getRepository(NotificationOutbox).save(outbox1);
        await projectorService.projectEvent(outbox1.id, "tok-c1");

        // Comment 2 (latest)
        const c2 = await commentService.create(commenter2, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "Second comment",
        });

        const outbox2 = await dataSource
            .getRepository(NotificationOutbox)
            .findOneOrFail({
                where: { actorUserId: commenter2 },
            });
        outbox2.state = "processing";
        outbox2.ownerToken = "tok-c2";
        outbox2.ownerExpiresAt = new Date(Date.now() + 60000);
        await dataSource.getRepository(NotificationOutbox).save(outbox2);
        await projectorService.projectEvent(outbox2.id, "tok-c2");

        // Acknowledge read up to version 1
        await dataSource
            .getRepository(NotificationInbox)
            .update({ rootId: postId }, { readVersion: 1 });

        // Group now has eventCount = 2, version = 2, readVersion = 1
        const groupBefore = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({ rootId: postId });
        expect(groupBefore.eventCount).toBe(2);
        expect(groupBefore.version).toBe(2);
        expect(groupBefore.readVersion).toBe(1);
        expect(groupBefore.isRedacted).toBe(false);

        // Delete latest comment c2
        await commentService.delete(commenter2, c2.id, {
            sourceType: CommentSourceType.POST,
        });

        // Inbox item is redacted, preserved visible, and retains readVersion!
        const groupAfter = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({ rootId: postId });
        expect(groupAfter.isVisible).toBe(true);
        expect(groupAfter.isRedacted).toBe(true);
        expect(groupAfter.preview?.text).toBe("[Comment deleted]");
        expect(groupAfter.readVersion).toBe(1); // Read version preserved!

        // Now delete the remaining comment c1
        await commentService.delete(commenter1, c1.id, {
            sourceType: CommentSourceType.POST,
        });

        // Now with 0 active comments, it becomes hidden
        const groupFinal = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({ rootId: postId });
        expect(groupFinal.isVisible).toBe(false);

        const replacement = await commentService.create(commenter1, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "A new safe comment",
        });
        const event = await dataSource
            .getRepository(NotificationOutbox)
            .findOneByOrFail({
                actorUserId: commenter1,
                state: "pending",
            });
        await dataSource.getRepository(NotificationOutbox).update(
            { id: event.id },
            {
                state: "processing",
                ownerToken: "replacement",
                ownerExpiresAt: new Date(Date.now() + 30000),
            },
        );
        expect(
            await projectorService.projectEvent(event.id, "replacement"),
        ).toBe(true);
        expect(
            await dataSource
                .getRepository(NotificationInbox)
                .findOneByOrFail({ id: groupFinal.id }),
        ).toMatchObject({
            isVisible: true,
            isRedacted: false,
            version: 3,
            readVersion: 1,
            preview: { text: "A new safe comment" },
            target: { focusId: replacement.id },
        });
    });
});
