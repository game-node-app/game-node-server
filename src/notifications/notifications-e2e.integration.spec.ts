import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { randomUUID } from "crypto";
import { NotificationsService } from "./notifications.service";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationsProjectorService } from "./notifications-projector.service";
import { NotificationsLifecycleService } from "./notifications-lifecycle.service";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { Profile } from "../profile/entities/profile.entity";
import { Post } from "../posts/entity/post.entity";
import { PostsService } from "../posts/posts.service";
import { PostsRepository } from "../posts/posts.repository";
import { CommentService } from "../comment/comment.service";
import { CommentSourceType } from "../comment/comment.constants";
import { CollectionsService } from "../collections/collections.service";
import { Collection } from "../collections/entities/collection.entity";

describe("Integrated end-to-end acceptance (Section 10)", () => {
    let dataSource: DataSource;
    let notificationsService: NotificationsService;
    let relayService: NotificationsRelayService;
    let projectorService: NotificationsProjectorService;
    let lifecycleService: NotificationsLifecycleService;
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

        relayService = new NotificationsRelayService(
            dataSource,
            dataSource.getRepository(NotificationOutbox),
            { add: jest.fn() } as any,
        );

        projectorService = new NotificationsProjectorService(
            dataSource,
            relayService,
        );

        notificationsService = new NotificationsService(
            dataSource.getRepository(NotificationInbox),
            dataSource.getRepository(Profile),
            dataSource,
        );

        postsService = new PostsService(
            new PostsRepository(dataSource.manager),
            {} as any,
            { register: jest.fn() } as any,
            lifecycleService,
        );

        commentService = new CommentService(
            dataSource,
            { createStatistics: jest.fn() } as any,
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

    async function createProfile(userId: string) {
        await dataSource.query(
            `INSERT INTO profile (userId, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)`,
            [userId, `user_${userId.slice(0, 8)}`],
        );
    }

    it("exercises end-to-end comment, reply, and read acknowledgement flow", async () => {
        await dataSource.query(`DELETE FROM notification_outbox`);
        await dataSource.query(`DELETE FROM notification_inbox`);

        const postOwner = randomUUID();
        const commenter = randomUUID();
        const replier = randomUUID();
        const postId = randomUUID();

        await createProfile(postOwner);
        await createProfile(commenter);
        await createProfile(replier);

        // 1. Create post
        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'E2E Post', NOW(), NOW())`,
            [postId, postOwner],
        );

        // 2. Commenter comments on post (domain write + transactional intent append)
        const comment = await commentService.create(commenter, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "Hello world comment",
        });

        // Relay claims row
        const claimed = await relayService.claimDueRows(10, 30000);
        const commentOutbox = claimed.find(
            (r) => r.recipientUserId === postOwner,
        );
        expect(commentOutbox).toBeDefined();

        // Projector materializes
        await projectorService.projectEvent(
            commentOutbox!.id,
            commentOutbox!.ownerToken!,
        );

        // Verify post owner sees unread comment
        const postOwnerInbox = await notificationsService.findAll(postOwner, {
            limit: 10,
        });
        expect(postOwnerInbox.data).toHaveLength(1);
        expect(postOwnerInbox.unreadCount).toBe(1);
        expect(postOwnerInbox.data[0].type).toBe("comment.created");
        expect(postOwnerInbox.data[0].preview?.text).toBe(
            "Hello world comment",
        );
        expect(postOwnerInbox.data[0].actors[0].userId).toBe(commenter);

        // 3. Replier replies to commenter (replier -> commenter notification)
        await commentService.create(replier, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "Reply to your comment",
            childOf: comment.id,
        });

        const claimedReply = await relayService.claimDueRows(10, 30000);
        const replyOutbox = claimedReply.find(
            (r) => r.recipientUserId === commenter,
        );
        expect(replyOutbox).toBeDefined();

        await projectorService.projectEvent(
            replyOutbox!.id,
            replyOutbox!.ownerToken!,
        );

        // Commenter sees reply
        const commenterInbox = await notificationsService.findAll(commenter, {
            limit: 10,
        });
        expect(commenterInbox.data).toHaveLength(1);
        expect(commenterInbox.unreadCount).toBe(1);
        expect(commenterInbox.data[0].type).toBe("comment.replied");
        expect(commenterInbox.data[0].preview?.text).toBe(
            "Reply to your comment",
        );

        // 4. Commenter acknowledges read
        await notificationsService.acknowledgeRead(commenter, {
            items: [
                {
                    id: commenterInbox.data[0].id,
                    version: commenterInbox.data[0].version,
                },
            ],
        });

        const commenterAfterRead = await notificationsService.findAll(
            commenter,
            { limit: 10 },
        );
        expect(commenterAfterRead.unreadCount).toBe(0);

        // Cross-recipient check: Replier cannot view or acknowledge Commenter's inbox
        const replierInbox = await notificationsService.findAll(replier, {
            limit: 10,
        });
        expect(replierInbox.data).toHaveLength(0);
    });

    it("delivers a review reply to the parent owner with the triggering reply focus", async () => {
        const owner = randomUUID();
        const commenter = randomUUID();
        const replier = randomUUID();
        const reviewId = randomUUID();
        const entryId = randomUUID();
        for (const id of [owner, commenter, replier]) await createProfile(id);
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            owner,
        ]);
        await dataSource.query(
            "INSERT INTO collection_entry (id, libraryUserId, gameId) VALUES (?, ?, 1)",
            [entryId, owner],
        );
        await dataSource.query(
            "INSERT INTO review (id, profileUserId, gameId, collectionEntryId, rating) VALUES (?, ?, 1, ?, 5)",
            [reviewId, owner, entryId],
        );
        const parent = await commentService.create(commenter, {
            sourceType: CommentSourceType.REVIEW,
            sourceId: reviewId,
            content: "Parent comment",
        });
        const reply = await commentService.create(replier, {
            sourceType: CommentSourceType.REVIEW,
            sourceId: reviewId,
            childOf: parent.id,
            content: "Review reply",
        });
        const event = await dataSource
            .getRepository(NotificationOutbox)
            .findOneByOrFail({ actorUserId: replier });
        await dataSource.getRepository(NotificationOutbox).update(event.id, {
            state: "processing",
            ownerToken: "review-reply",
            ownerExpiresAt: new Date(Date.now() + 60000),
        });
        expect(
            await projectorService.projectEvent(event.id, "review-reply"),
        ).toBe(true);
        const page = await notificationsService.findAll(commenter, {
            limit: 20,
        });
        expect(page.data).toHaveLength(1);
        expect(page.data[0]).toMatchObject({
            type: "comment.replied",
            preview: { text: "Review reply" },
            target: { type: "review", id: reviewId, focusId: reply.id },
        });
    });

    it("recovers expired worker leases safely and blocks stale worker attempts", async () => {
        const recipient = randomUUID();
        const actor = randomUUID();
        await createProfile(recipient);
        await createProfile(actor);

        const outboxRepo = dataSource.getRepository(NotificationOutbox);
        const eventId = randomUUID();

        // Expired lease on outbox row
        await outboxRepo.save({
            id: eventId,
            eventType: "profile.followed",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: recipient,
            actorUserId: actor,
            payload: { followId: 1 },
            state: "processing",
            ownerToken: "stale-worker-token",
            ownerExpiresAt: new Date(Date.now() - 5000), // expired 5 seconds ago!
            attempts: 1,
            nextAttemptAt: new Date(Date.now() - 5000),
        });

        // Worker 2 claims expired row
        await relayService.claimDueRows(10, 30000);
        await outboxRepo.update({ id: eventId }, { nextAttemptAt: new Date(Date.now() - 1000) });
        const claimed = await relayService.claimDueRows(10, 30000);
        const row = claimed.find((r) => r.id === eventId);
        expect(row).toBeDefined();
        expect(row!.ownerToken).not.toBe("stale-worker-token");

        // Worker 1 (stale) attempts to project with expired token -> rejected!
        const staleSuccess = await projectorService.projectEvent(
            eventId,
            "stale-worker-token",
        );
        expect(staleSuccess).toBe(false);

        // Worker 2 projects with valid active token -> completes!
        const validSuccess = await projectorService.projectEvent(
            eventId,
            row!.ownerToken!,
        );
        expect(validSuccess).toBe(true);

        const completedRow = await outboxRepo.findOneByOrFail({ id: eventId });
        expect(completedRow.state).toBe("completed");
    });

    it("delivers like, importer, and moderation events and respects privacy changes", async () => {
        const userA = randomUUID();
        const userB = randomUUID();
        const userC = randomUUID();
        await createProfile(userA);
        await createProfile(userB);
        await createProfile(userC);

        const outboxRepo = dataSource.getRepository(NotificationOutbox);

        // 1. Like events grouped together
        const postId = randomUUID();
        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post for likes', NOW(), NOW())`,
            [postId, userA],
        );

        // Like from userB
        const likeOutbox1 = await outboxRepo.save({
            id: randomUUID(),
            eventType: "content.liked",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: userA,
            actorUserId: userB,
            payload: { likeId: 1, subjectType: "post", subjectId: postId },
            state: "processing",
            ownerToken: "tok-like-1",
            ownerExpiresAt: new Date(Date.now() + 60000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        await projectorService.projectEvent(likeOutbox1.id, "tok-like-1");

        // Like from userC
        const likeOutbox2 = await outboxRepo.save({
            id: randomUUID(),
            eventType: "content.liked",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: userA,
            actorUserId: userC,
            payload: { likeId: 2, subjectType: "post", subjectId: postId },
            state: "processing",
            ownerToken: "tok-like-2",
            ownerExpiresAt: new Date(Date.now() + 60000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        await projectorService.projectEvent(likeOutbox2.id, "tok-like-2");

        // User A's inbox groups the 2 likes into 1 item with 2 actors and 2 events
        const userAInbox = await notificationsService.findAll(userA, {
            limit: 10,
        });
        const likeGroup = userAInbox.data.find(
            (d) => d.type === "content.liked",
        );
        expect(likeGroup).toBeDefined();
        expect(likeGroup!.eventCount).toBe(2);
        expect(likeGroup!.actorCount).toBe(2);
        expect(likeGroup!.actors).toHaveLength(2);

        // 2. Importer discovery completed
        const importOutbox = await outboxRepo.save({
            id: randomUUID(),
            eventType: "import.discovery-completed",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: userA,
            actorUserId: null,
            payload: {
                discoveryResultId: 99,
                provider: "steam",
                gameCount: 10,
                importedCount: 8,
                skippedCount: 2,
                failedCount: 0,
                gameSample: [{ id: 1, title: "Half-Life" }],
            },
            state: "processing",
            ownerToken: "tok-imp",
            ownerExpiresAt: new Date(Date.now() + 60000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        await projectorService.projectEvent(importOutbox.id, "tok-imp");

        const userAWithImport = await notificationsService.findAll(userA, {
            limit: 10,
        });
        const importItem = userAWithImport.data.find(
            (d) => d.type === "import.discovery-completed",
        );
        expect(importItem).toBeDefined();
        expect(importItem!.preview?.importedCount).toBe(8);

        // 3. Moderation applied (system actor, safe outcome)
        const modOutbox = await outboxRepo.save({
            id: randomUUID(),
            eventType: "moderation.applied",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: userB,
            actorUserId: null,
            payload: {
                action: "alert",
                safeReason: "Spam behavior",
                reportId: 5,
            },
            state: "processing",
            ownerToken: "tok-mod",
            ownerExpiresAt: new Date(Date.now() + 60000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        await projectorService.projectEvent(modOutbox.id, "tok-mod");

        const userBInbox = await notificationsService.findAll(userB, {
            limit: 10,
        });
        const modItem = userBInbox.data.find(
            (d) => d.type === "moderation.applied",
        );
        expect(modItem).toBeDefined();
        expect(modItem!.actors).toHaveLength(0); // System actor
        expect(modItem!.preview?.reason).toBe("Spam behavior");

        // 4. Privacy changes: collection made private hides review notifications
        const collectionId = randomUUID();
        const entryId = randomUUID();
        const reviewId = randomUUID();

        await dataSource.query(
            `INSERT INTO library (userId, createdAt, updatedAt) VALUES (?, NOW(), NOW()) ON DUPLICATE KEY UPDATE userId = userId`,
            [userA],
        );
        await dataSource.query(
            `INSERT INTO collection (id, libraryUserId, name, isPublic, createdAt, updatedAt)
             VALUES (?, ?, 'Public Collection', 1, NOW(), NOW())`,
            [collectionId, userA],
        );
        await dataSource.query(
            `INSERT INTO collection_entry (id, libraryUserId, gameId, createdAt, updatedAt)
             VALUES (?, ?, 1, NOW(), NOW())`,
            [entryId, userA],
        );
        await dataSource.query(
            `INSERT INTO collection_entry_collections_collection (collectionEntryId, collectionId, \`order\`, createdAt)
             VALUES (?, ?, 0, NOW())`,
            [entryId, collectionId],
        );
        await dataSource.query(
            `INSERT INTO review (id, profileUserId, gameId, collectionEntryId, content, rating, createdAt, updatedAt)
             VALUES (?, ?, 1, ?, 'Great game review', 5, NOW(), NOW())`,
            [reviewId, userA, entryId],
        );

        // User B likes User A's review
        const reviewLikeOutbox = await outboxRepo.save({
            id: randomUUID(),
            eventType: "content.liked",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: userA,
            actorUserId: userB,
            payload: { likeId: 3, subjectType: "review", subjectId: reviewId },
            state: "processing",
            ownerToken: "tok-rev-like",
            ownerExpiresAt: new Date(Date.now() + 60000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        await projectorService.projectEvent(
            reviewLikeOutbox.id,
            "tok-rev-like",
        );

        // User A sees review like
        const inboxBeforePrivacy = await notificationsService.findAll(userA, {
            limit: 20,
        });
        const reviewLikeBefore = inboxBeforePrivacy.data.find(
            (d) => d.target?.id === reviewId,
        );
        expect(reviewLikeBefore).toBeDefined();

        // User A makes collection private!
        await collectionsService.update(userA, collectionId, {
            isPublic: false,
        });

        // Review like notification is immediately hidden from list!
        const inboxAfterPrivacy = await notificationsService.findAll(userA, {
            limit: 20,
        });
        const reviewLikeAfter = inboxAfterPrivacy.data.find(
            (d) => d.target?.id === reviewId,
        );
        expect(reviewLikeAfter).toBeUndefined();
    });
});
