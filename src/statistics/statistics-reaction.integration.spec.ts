import "reflect-metadata";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import * as outboxModule from "../notifications/notifications-outbox.service";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { StatisticsService } from "./statistics.service";
import { StatisticsSourceType } from "./statistics.constants";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { CommentStatistics } from "./entity/comment-statistics.entity";
import { PostStatistics } from "./entity/post-statistics.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { NotificationEvent } from "../notifications/entity/notification-event.entity";
import { NotificationInbox } from "../notifications/entity/notification-inbox.entity";
import { BadRequestException, NotFoundException } from "@nestjs/common";

describe("StatisticsService reaction commands (PUT/DELETE like)", () => {
    let dataSource: DataSource;
    let service: StatisticsService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new StatisticsService(dataSource);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    async function createMockProfile(userId: string) {
        const username = `u_${userId.slice(0, 16)}`;
        await dataSource.query(
            `INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt)
             VALUES (?, ?, NOW(), NOW())`,
            [userId, username],
        );
    }

    describe("target existence and validation", () => {
        it("rejects a reaction racing an uncommitted source deletion", async () => {
            const owner = randomUUID(),
                actor = randomUUID(),
                postId = randomUUID();
            for (const user of [owner, actor]) await createMockProfile(user);
            await dataSource.query(
                "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Concurrent removal')",
                [postId, owner],
            );
            let enter!: () => void, release!: () => void;
            const entered = new Promise<void>((resolve) => {
                enter = resolve;
            });
            const resume = new Promise<void>((resolve) => {
                release = resolve;
            });
            const removal = dataSource.transaction(async (manager) => {
                await manager.query(
                    "UPDATE post SET deletedAt = NOW() WHERE id = ?",
                    [postId],
                );
                enter();
                await resume;
            });
            await entered;
            const reaction = service.applyReaction(
                actor,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                true,
            );
            const rejected =
                expect(reaction).rejects.toThrow(NotFoundException);
            release();
            await Promise.all([removal, rejected]);
            expect(
                await dataSource
                    .getRepository(PostStatistics)
                    .countBy({ postId }),
            ).toBe(0);
            expect(
                await dataSource
                    .getRepository(UserLike)
                    .countBy({ profileUserId: actor }),
            ).toBe(0);
            expect(
                await dataSource
                    .getRepository(NotificationOutbox)
                    .countBy({ actorUserId: actor }),
            ).toBe(0);
        });
        it("rejects deleted posts and inaccessible review/activity/comment roots before statistics writes", async () => {
            const owner = randomUUID();
            const actor = randomUUID();
            const postId = randomUUID();
            const entryId = randomUUID();
            const collectionId = randomUUID();
            const reviewId = randomUUID();
            const activityId = randomUUID();
            const commentId = randomUUID();
            for (const user of [owner, actor]) await createMockProfile(user);
            await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
                owner,
            ]);
            await dataSource.query(
                "INSERT INTO post (id, profileUserId, gameId, content, deletedAt) VALUES (?, ?, 1, 'Removed', NOW())",
                [postId, owner],
            );
            await dataSource.query(
                "INSERT INTO collection (id, libraryUserId, name, isPublic) VALUES (?, ?, 'Private', 0)",
                [collectionId, owner],
            );
            await dataSource.query(
                "INSERT INTO collection_entry (id, libraryUserId, gameId) VALUES (?, ?, 1)",
                [entryId, owner],
            );
            await dataSource.query(
                "INSERT INTO collection_entry_collections_collection (collectionEntryId, collectionId, `order`, createdAt) VALUES (?, ?, 0, NOW())",
                [entryId, collectionId],
            );
            await dataSource.query(
                "INSERT INTO review (id, profileUserId, gameId, collectionEntryId, rating) VALUES (?, ?, 1, ?, 5)",
                [reviewId, owner, entryId],
            );
            await dataSource.query(
                "INSERT INTO activity (id, profileUserId, type, collectionId, collectionEntryId) VALUES (?, ?, 'collection_entry', ?, ?)",
                [activityId, owner, collectionId, entryId],
            );
            await dataSource.query(
                "INSERT INTO review_comment (id, profileUserId, reviewId, content) VALUES (?, ?, ?, 'Protected')",
                [commentId, owner, reviewId],
            );
            for (const [sourceType, sourceId, statistics] of [
                [StatisticsSourceType.POST, postId, PostStatistics],
                [StatisticsSourceType.REVIEW, reviewId, ReviewStatistics],
                [StatisticsSourceType.ACTIVITY, activityId, ActivityStatistics],
                [
                    StatisticsSourceType.REVIEW_COMMENT,
                    commentId,
                    CommentStatistics,
                ],
            ] as const) {
                const before = await dataSource
                    .getRepository(statistics)
                    .count();
                await expect(
                    service.applyReaction(
                        actor,
                        { sourceType, sourceId },
                        true,
                    ),
                ).rejects.toThrow(NotFoundException);
                expect(await dataSource.getRepository(statistics).count()).toBe(
                    before,
                );
            }
            expect(
                await dataSource
                    .getRepository(UserLike)
                    .countBy({ profileUserId: actor }),
            ).toBe(0);
            expect(
                await dataSource
                    .getRepository(NotificationOutbox)
                    .countBy({ actorUserId: actor }),
            ).toBe(0);
        });

        it("rejects non-existent targets without creating statistics or reactions", async () => {
            const nonExistentId = randomUUID();
            await expect(
                service.applyReaction(
                    "user-1",
                    {
                        sourceType: StatisticsSourceType.POST,
                        sourceId: nonExistentId,
                    },
                    true,
                ),
            ).rejects.toThrow(NotFoundException);

            const stats = await dataSource
                .getRepository(PostStatistics)
                .findOneBy({ postId: nonExistentId });
            expect(stats).toBeNull();
        });

        it("rejects unknown / forged properties on reaction request", async () => {
            const dto: any = {
                sourceType: StatisticsSourceType.POST,
                sourceId: randomUUID(),
                targetUserId: "forged-recipient",
                actor: "forged-actor",
            };
            await expect(
                service.applyReaction("user-1", dto, true),
            ).rejects.toThrow(BadRequestException);
        });
    });

    describe("atomic reaction transitions, counters, and outbox intent", () => {
        it("rolls back reaction insertion when the counter write fails, then retries successfully", async () => {
            const owner = randomUUID(),
                actor = randomUUID(),
                postId = randomUUID();
            for (const user of [owner, actor]) await createMockProfile(user);
            await dataSource.query(
                "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, 1, 'Counter failure')",
                [postId, owner],
            );
            const createRunner = dataSource.createQueryRunner.bind(dataSource);
            const factory = jest
                .spyOn(dataSource, "createQueryRunner")
                .mockImplementation((mode) => {
                    const runner = createRunner(mode),
                        query = runner.query.bind(runner);
                    jest.spyOn(runner, "query").mockImplementation(
                        async (...args: Parameters<typeof runner.query>) => {
                            if (
                                args[0].startsWith("UPDATE") &&
                                args[0].includes("post_statistics") &&
                                args[0].includes("likesCount")
                            )
                                throw new Error("counter unavailable");
                            return query(...args);
                        },
                    );
                    return runner;
                });
            try {
                await expect(
                    service.applyReaction(
                        actor,
                        {
                            sourceType: StatisticsSourceType.POST,
                            sourceId: postId,
                        },
                        true,
                    ),
                ).rejects.toThrow("counter unavailable");
            } finally {
                factory.mockRestore();
            }
            expect(
                await dataSource
                    .getRepository(PostStatistics)
                    .countBy({ postId }),
            ).toBe(0);
            expect(
                await dataSource
                    .getRepository(UserLike)
                    .countBy({ profileUserId: actor }),
            ).toBe(0);
            expect(
                await dataSource
                    .getRepository(NotificationOutbox)
                    .countBy({ actorUserId: actor }),
            ).toBe(0);
            expect(
                await service.applyReaction(
                    actor,
                    { sourceType: StatisticsSourceType.POST, sourceId: postId },
                    true,
                ),
            ).toEqual({ isLiked: true, likesCount: 1 });
        });
        it("retries the whole transaction after a deadlock and rolls back an outbox failure", async () => {
            const owner = randomUUID();
            const users = [randomUUID(), randomUUID()];
            const entryId = randomUUID();
            const reviewId = randomUUID();
            for (const id of [owner, ...users]) await createMockProfile(id);
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

            const actors = new AsyncLocalStorage<string>();
            const createRunner = dataSource.createQueryRunner.bind(dataSource);
            const append = outboxModule.appendNotificationIntent;
            let victim: string | undefined;
            const runnerFactory = jest
                .spyOn(dataSource, "createQueryRunner")
                .mockImplementation((mode) => {
                    const runner = createRunner(mode);
                    const query = runner.query.bind(runner);
                    jest.spyOn(runner, "query").mockImplementation(
                        async (...args: Parameters<typeof runner.query>) => {
                            const [sql, parameters] = args;
                            if (
                                !victim &&
                                sql.startsWith("SELECT") &&
                                sql.includes("review_statistics") &&
                                parameters?.includes(reviewId)
                            ) {
                                victim = actors.getStore();
                                throw Object.assign(
                                    new Error("injected transaction deadlock"),
                                    { code: "ER_LOCK_DEADLOCK" },
                                );
                            }
                            return query(...args);
                        },
                    );
                    return runner;
                });
            const appendSpy = jest
                .spyOn(outboxModule, "appendNotificationIntent")
                .mockImplementation((manager, intent) => {
                    if (intent.actorUserId === victim)
                        throw new Error("outbox unavailable");
                    return append(manager, intent);
                });
            let outcomes: PromiseSettledResult<unknown>[];
            try {
                outcomes = await Promise.allSettled(
                    users.map((user) =>
                        actors.run(user, () =>
                            service.applyReaction(
                                user,
                                {
                                    sourceType: StatisticsSourceType.REVIEW,
                                    sourceId: reviewId,
                                },
                                true,
                            ),
                        ),
                    ),
                );
            } finally {
                runnerFactory.mockRestore();
                appendSpy.mockRestore();
            }

            expect(victim).toBeDefined();
            expect(
                outcomes.filter((r) => r.status === "rejected"),
            ).toHaveLength(1);
            const stats = await dataSource
                .getRepository(ReviewStatistics)
                .findOneByOrFail({ reviewId });
            expect(Number(stats.likesCount)).toBe(1);
            const [counts] = await dataSource.query(
                "SELECT COUNT(*) AS reactions FROM user_like WHERE reviewStatisticsId = ?",
                [stats.id],
            );
            expect(Number(counts.reactions)).toBe(1);
            expect(
                await dataSource
                    .getRepository(NotificationOutbox)
                    .countBy({ recipientUserId: owner }),
            ).toBe(1);

            await expect(
                service.applyReaction(
                    victim!,
                    {
                        sourceType: StatisticsSourceType.REVIEW,
                        sourceId: reviewId,
                    },
                    true,
                ),
            ).resolves.toEqual({ isLiked: true, likesCount: 2 });
            expect(
                await dataSource
                    .getRepository(NotificationOutbox)
                    .countBy({ recipientUserId: owner }),
            ).toBe(2);
        });

        it("initializes missing statistics, increments counter, and appends notification intent", async () => {
            const postOwner = randomUUID();
            const liker = randomUUID();
            const postId = randomUUID();

            await createMockProfile(postOwner);
            await createMockProfile(liker);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Post for reaction test', NOW(), NOW())`,
                [postId, postOwner],
            );

            // Initially no PostStatistics exists
            const initialStats = await dataSource
                .getRepository(PostStatistics)
                .findOneBy({ postId });
            expect(initialStats).toBeNull();

            // Like reaction
            const result = await service.applyReaction(
                liker,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                true,
            );

            expect(result.isLiked).toBe(true);
            expect(result.likesCount).toBe(1);

            // Verify PostStatistics was created
            const createdStats = await dataSource
                .getRepository(PostStatistics)
                .findOneBy({ postId });
            expect(createdStats).not.toBeNull();
            expect(Number(createdStats?.likesCount)).toBe(1);

            // Verify UserLike row
            const userLike = await dataSource
                .getRepository(UserLike)
                .findOneBy({
                    profileUserId: liker,
                    postStatisticsId: createdStats?.id,
                });
            expect(userLike).not.toBeNull();

            // Verify NotificationOutbox intent was appended for postOwner
            const outbox = await dataSource
                .getRepository(NotificationOutbox)
                .findOneBy({
                    recipientUserId: postOwner,
                    actorUserId: liker,
                });
            expect(outbox).not.toBeNull();
            expect(outbox?.eventType).toBe("content.liked");
            expect(outbox?.payload?.likeId).toBe(userLike?.id);
            expect(outbox?.payload?.subjectId).toBe(postId);

            // Cleanup
            if (outbox)
                await dataSource
                    .getRepository(NotificationOutbox)
                    .delete({ id: outbox.id });
            await dataSource
                .getRepository(UserLike)
                .delete({ id: userLike!.id });
            await dataSource
                .getRepository(PostStatistics)
                .delete({ id: createdStats!.id });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("is idempotent on repeated same-user like requests", async () => {
            const postOwner = randomUUID();
            const liker = randomUUID();
            const postId = randomUUID();

            await createMockProfile(postOwner);
            await createMockProfile(liker);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Idempotency test', NOW(), NOW())`,
                [postId, postOwner],
            );

            // First like
            const [res1, concurrent] = await Promise.all(
                [1, 2].map(() =>
                    service.applyReaction(
                        liker,
                        {
                            sourceType: StatisticsSourceType.POST,
                            sourceId: postId,
                        },
                        true,
                    ),
                ),
            );
            expect(concurrent).toEqual({ isLiked: true, likesCount: 1 });
            expect(res1.isLiked).toBe(true);
            expect(res1.likesCount).toBe(1);

            // Second like
            const res2 = await service.applyReaction(
                liker,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                true,
            );
            expect(res2.isLiked).toBe(true);
            expect(res2.likesCount).toBe(1); // count not incremented!

            // Verify only one UserLike exists
            const likes = await dataSource
                .getRepository(UserLike)
                .findBy({ profileUserId: liker });
            expect(likes.length).toBe(1);
            expect(
                await dataSource
                    .getRepository(NotificationOutbox)
                    .countBy({
                        actorUserId: liker,
                        recipientUserId: postOwner,
                    }),
            ).toBe(1);

            // Cleanup
            await dataSource
                .getRepository(NotificationOutbox)
                .delete({ actorUserId: liker });
            await dataSource
                .getRepository(UserLike)
                .delete({ id: likes[0].id });
            await dataSource.getRepository(PostStatistics).delete({ postId });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("handles concurrent likes from distinct users and concurrent unlikes", async () => {
            const postOwner = randomUUID();
            const user1 = randomUUID();
            const user2 = randomUUID();
            const postId = randomUUID();

            await createMockProfile(postOwner);
            await createMockProfile(user1);
            await createMockProfile(user2);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Concurrency test', NOW(), NOW())`,
                [postId, postOwner],
            );

            // Concurrent likes from user1 and user2
            const [res1, res2] = await Promise.all([
                service.applyReaction(
                    user1,
                    { sourceType: StatisticsSourceType.POST, sourceId: postId },
                    true,
                ),
                service.applyReaction(
                    user2,
                    { sourceType: StatisticsSourceType.POST, sourceId: postId },
                    true,
                ),
            ]);

            expect(res1.isLiked).toBe(true);
            expect(res2.isLiked).toBe(true);

            const stats = await dataSource
                .getRepository(PostStatistics)
                .findOneBy({ postId });
            expect(Number(stats?.likesCount)).toBe(2);

            // Concurrent unlikes from user1 (twice)
            const [un1, un2] = await Promise.all([
                service.applyReaction(
                    user1,
                    { sourceType: StatisticsSourceType.POST, sourceId: postId },
                    false,
                ),
                service.applyReaction(
                    user1,
                    { sourceType: StatisticsSourceType.POST, sourceId: postId },
                    false,
                ),
            ]);

            expect(un1.isLiked).toBe(false);
            expect(un2.isLiked).toBe(false);

            const updatedStats = await dataSource
                .getRepository(PostStatistics)
                .findOneBy({ postId });
            expect(Number(updatedStats?.likesCount)).toBe(1); // decremented once!

            // Cleanup
            await dataSource
                .getRepository(NotificationOutbox)
                .delete({ recipientUserId: postOwner });
            await dataSource
                .getRepository(UserLike)
                .delete({ profileUserId: user2 });
            await dataSource.getRepository(PostStatistics).delete({ postId });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("does not generate notification intent for self-likes or game likes", async () => {
            const user = randomUUID();
            const postId = randomUUID();

            await createMockProfile(user);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Self like test', NOW(), NOW())`,
                [postId, user],
            );

            // Self-like
            const selfRes = await service.applyReaction(
                user,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                true,
            );
            expect(selfRes.isLiked).toBe(true);

            // No outbox event should exist for self-like
            const outboxSelf = await dataSource
                .getRepository(NotificationOutbox)
                .findOneBy({ actorUserId: user });
            expect(outboxSelf).toBeNull();

            // Game like (game with id = 1 exists in DB)
            const gameRes = await service.applyReaction(
                user,
                { sourceType: StatisticsSourceType.GAME, sourceId: 1 },
                true,
            );
            expect(gameRes.isLiked).toBe(true);

            const outboxGame = await dataSource
                .getRepository(NotificationOutbox)
                .findOneBy({ actorUserId: user, eventType: "content.liked" });
            expect(outboxGame).toBeNull();

            // Unlike cleanup
            await service.applyReaction(
                user,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                false,
            );
            await service.applyReaction(
                user,
                { sourceType: StatisticsSourceType.GAME, sourceId: 1 },
                false,
            );
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });

        it("uses distinct real-transition identities across like -> unlike -> like", async () => {
            const postOwner = randomUUID();
            const user = randomUUID();
            const postId = randomUUID();

            await createMockProfile(postOwner);
            await createMockProfile(user);

            await dataSource.query(
                `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
                 VALUES (?, ?, 1, 'Transition identity test', NOW(), NOW())`,
                [postId, postOwner],
            );

            // Like 1
            await service.applyReaction(
                user,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                true,
            );
            // Unlike
            await service.applyReaction(
                user,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                false,
            );

            // Like 2
            await service.applyReaction(
                user,
                { sourceType: StatisticsSourceType.POST, sourceId: postId },
                true,
            );

            const outboxItems = await dataSource
                .getRepository(NotificationOutbox)
                .find({
                    where: { actorUserId: user },
                });
            expect(outboxItems).toHaveLength(2);

            const likeId1 = outboxItems[0].payload?.likeId;
            const likeId2 = outboxItems[1].payload?.likeId;
            expect(likeId1).toBeDefined();
            expect(likeId2).toBeDefined();

            // The new transition identity is distinct from the first!
            expect(likeId2).not.toBe(likeId1);

            // Active counter is 1
            const stats = await dataSource
                .getRepository(PostStatistics)
                .findOneBy({ postId });
            expect(Number(stats?.likesCount)).toBe(1);

            // Cleanup
            await dataSource
                .getRepository(NotificationOutbox)
                .delete({ recipientUserId: postOwner });
            await dataSource
                .getRepository(UserLike)
                .delete({ profileUserId: user });
            await dataSource.getRepository(PostStatistics).delete({ postId });
            await dataSource.query(`DELETE FROM post WHERE id = ?`, [postId]);
        });
    });
});
