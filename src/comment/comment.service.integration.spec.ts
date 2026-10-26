import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { CommentService } from "./comment.service";
import { CommentSourceType } from "./comment.constants";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { PostComment } from "./entity/post-comment.entity";
import { Post } from "../posts/entity/post.entity";
import { Profile } from "../profile/entities/profile.entity";
import { randomUUID } from "crypto";
import { HttpException, HttpStatus } from "@nestjs/common";
import * as outboxModule from "../notifications/notifications-outbox.service";


describe("CommentService integration (Task 5.1)", () => {
    let dataSource: DataSource;
    let service: CommentService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new CommentService(dataSource);
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

    it("verifies top-level comment recipient and outbox intent", async () => {
        const owner = randomUUID();
        const commenter = randomUUID();
        const postId = randomUUID();

        await createMockProfile(owner);
        await createMockProfile(commenter);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post for comment test', NOW(), NOW())`,
            [postId, owner],
        );

        const comment = await service.create(commenter, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "Hello from commenter!",
        });

        expect(comment.id).toBeDefined();

        const outbox = await dataSource.getRepository(NotificationOutbox).findOne({
            where: { actorUserId: commenter },
            order: { createdAt: "DESC" },
        });

        expect(outbox).not.toBeNull();
        expect(outbox?.eventType).toBe("comment.created");
        expect(outbox?.recipientUserId).toBe(owner);
        expect(outbox?.payload?.commentId).toBe(comment.id);
        expect(outbox?.payload?.rootType).toBe("post");
        expect(outbox?.payload?.rootId).toBe(postId);
    });

    it("verifies reply recipient targets parent comment owner, not root owner", async () => {
        const rootOwner = randomUUID();
        const parentAuthor = randomUUID();
        const replyAuthor = randomUUID();
        const postId = randomUUID();

        await createMockProfile(rootOwner);
        await createMockProfile(parentAuthor);
        await createMockProfile(replyAuthor);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post for reply test', NOW(), NOW())`,
            [postId, rootOwner],
        );

        // Parent comment by parentAuthor
        const parent = await service.create(parentAuthor, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "Top level comment",
        });

        // Reply by replyAuthor
        const reply = await service.create(replyAuthor, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            childOf: parent.id,
            content: "Reply to top level",
        });

        const outbox = await dataSource.getRepository(NotificationOutbox).findOne({
            where: { actorUserId: replyAuthor },
            order: { createdAt: "DESC" },
        });

        expect(outbox).not.toBeNull();
        expect(outbox?.eventType).toBe("comment.replied");
        expect(outbox?.recipientUserId).toBe(parentAuthor); // NOT rootOwner!
        expect(outbox?.payload?.commentId).toBe(reply.id);
        expect(outbox?.payload?.parentCommentId).toBe(parent.id);
        expect(outbox?.payload?.rootType).toBe("post");
        expect(outbox?.payload?.rootId).toBe(postId);
    });

    it("suppresses self-action notifications without failing comment creation", async () => {
        const owner = randomUUID();
        const postId = randomUUID();

        await createMockProfile(owner);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Self comment test', NOW(), NOW())`,
            [postId, owner],
        );

        // Owner comments on own post
        const comment = await service.create(owner, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            content: "My own comment",
        });

        expect(comment.id).toBeDefined();

        // No outbox event for self-comment
        const outbox = await dataSource.getRepository(NotificationOutbox).findOne({
            where: { actorUserId: owner, eventType: "comment.created" },
        });
        expect(outbox).toBeNull();

        // Owner replies to own comment
        const reply = await service.create(owner, {
            sourceType: CommentSourceType.POST,
            sourceId: postId,
            childOf: comment.id,
            content: "My reply to myself",
        });
        expect(reply.id).toBeDefined();

        const replyOutbox = await dataSource.getRepository(NotificationOutbox).findOne({
            where: { actorUserId: owner, eventType: "comment.replied" },
        });
        expect(replyOutbox).toBeNull();
    });

    it("rejects mismatched roots with 400 Bad Request", async () => {
        const user1 = randomUUID();
        const user2 = randomUUID();
        const post1 = randomUUID();
        const post2 = randomUUID();

        await createMockProfile(user1);
        await createMockProfile(user2);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post 1', NOW(), NOW()), (?, ?, 1, 'Post 2', NOW(), NOW())`,
            [post1, user1, post2, user2],
        );

        // Comment on post1
        const commentPost1 = await service.create(user2, {
            sourceType: CommentSourceType.POST,
            sourceId: post1,
            content: "Comment on post1",
        });

        // Attempt to reply on post2 targeting comment on post1
        await expect(
            service.create(user1, {
                sourceType: CommentSourceType.POST,
                sourceId: post2,
                childOf: commentPost1.id,
                content: "Illegal cross-post reply",
            }),
        ).rejects.toThrow("Parent comment belongs to a different root");
    });

    it("rolls back the transaction if intent append fails", async () => {
        const owner = randomUUID();
        const commenter = randomUUID();
        const postId = randomUUID();

        await createMockProfile(owner);
        await createMockProfile(commenter);

        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post for rollback test', NOW(), NOW())`,
            [postId, owner],
        );

        const spy = jest
            .spyOn(outboxModule, "appendNotificationIntent")
            .mockRejectedValueOnce(new Error("Simulated append failure"));

        try {
            await expect(
                service.create(commenter, {
                    sourceType: CommentSourceType.POST,
                    sourceId: postId,
                    content: "This comment will fail to commit",
                }),
            ).rejects.toThrow("Simulated append failure");

            // Verify no comment was saved!
            const count = await dataSource.getRepository(PostComment).count({
                where: { postId, profileUserId: commenter },
            });
            expect(count).toBe(0);
        } finally {
            spy.mockRestore();
        }
    });
});
