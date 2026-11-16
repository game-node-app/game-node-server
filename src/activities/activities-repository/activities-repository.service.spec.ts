jest.setTimeout(60000);
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { HttpException, HttpStatus } from "@nestjs/common";
import { DataSource, In } from "typeorm";
import { UnrecoverableError } from "bullmq";
import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { Activity } from "./entities/activity.entity";
import { ActivitiesRepositoryService } from "./activities-repository.service";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { StatisticsTarget } from "../../statistics/entity/statistics-target.entity";
import { MetricTotal } from "../../statistics/entity/metric-total.entity";
import { EngagementState } from "../../statistics/entity/engagement-state.entity";
import { StatisticsSourceType } from "../../statistics/statistics.constants";
import { lockoutAuthService } from "../../../test/mocks/lockout-auth-service.mock";
import { Game } from "../../game/game-repository/entities/game.entity";
import { GameCover } from "../../game/game-repository/entities/game-cover.entity";
import { GameRepositoryFindAllDto } from "../../game/game-repository/dto/game-repository-find-all.dto";

describe("ActivitiesRepositoryService (behavioral integration)", () => {
    let dataSource: DataSource;
    let service: ActivitiesRepositoryService;
    let postsService: any;
    let getLockoutStates: jest.Mock;
    let findAllByIds: jest.Mock;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        postsService = {
            findOneByIdOrFail: jest.fn(async (id: string) => ({
                id,
                gameId: 1,
            })),
        };
        getLockoutStates = jest.fn().mockResolvedValue(new Map());
        findAllByIds = jest.fn(async (dto: GameRepositoryFindAllDto) => {
            if (!dto?.gameIds?.length) {
                throw new HttpException("Invalid query.", HttpStatus.BAD_REQUEST);
            }
            const games = await dataSource.getRepository(Game).find({
                where: { id: In(dto.gameIds) },
                relations: dto.relations,
                relationLoadStrategy: "query",
            });
            if (games.length === 0) {
                throw new HttpException(
                    "No games match provided ids",
                    HttpStatus.NOT_FOUND,
                );
            }
            return games;
        });
        service = new ActivitiesRepositoryService(
            dataSource.getRepository(Activity),
            {} as any,
            {} as any,
            { isMature: jest.fn().mockResolvedValue(false) } as any,
            { getLockoutStates } as any,
            postsService,
            {
                findOneByIdOrFail: jest
                    .fn()
                    .mockResolvedValue({ externalGame: { gameId: 1 } }),
            } as any,
            { findAllByIds } as any,
        );
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    async function ensureProfile(userId: string, withAvatar = false) {
        let avatarId: number | null = null;
        if (withAvatar) {
            const result = await dataSource.query(
                "INSERT INTO profile_avatar (mimetype, extension, size, filename, encoding) VALUES ('image/png', 'png', 100, ?, '7bit')",
                [`avatar_${userId.slice(0, 8)}.png`],
            );
            avatarId = Number(result.insertId);
        }
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, avatarId) VALUES (?, ?, ?)",
            [userId, `u_${userId.slice(0, 10)}`, avatarId],
        );
        await dataSource.query(
            "INSERT IGNORE INTO library (userId) VALUES (?)",
            [userId],
        );
    }

    async function ensureGameWithCover(gameId: number, name: string) {
        await dataSource.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (?, ?, ?)",
            [gameId, name, `slug-${gameId}`],
        );
        await dataSource.getRepository(GameCover).save({
            id: gameId * 10 + 1,
            imageId: `cov_${gameId}`,
            url: `//images.igdb.com/igdb/image/upload/t_thumb/cov_${gameId}.jpg`,
            game: { id: gameId } as Game,
        });
    }

    async function ensurePost(postId: string, userId: string, gameId = 1) {
        await ensureProfile(userId);
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, ?, 'Post content')",
            [postId, userId, gameId],
        );
    }

    async function createStatsTarget(likesCount: number, likedByUserIds: string[] = []): Promise<number> {
        const res = await dataSource.query(
            "INSERT INTO statistics_target (sourceType, isActive) VALUES (?, 1)",
            [StatisticsSourceType.ACTIVITY],
        );
        const targetId = Number(res.insertId);
        await dataSource.query(
            "INSERT INTO metric_total (targetId, metricCode, metricValue) VALUES (?, 'likes_current', ?)",
            [targetId, likesCount],
        );
        for (const userId of likedByUserIds) {
            await dataSource.query(
                "INSERT INTO engagement_state (targetId, profileUserId, likedAt, firstLikedAt) VALUES (?, ?, NOW(6), NOW(6))",
                [targetId, userId],
            );
        }
        return targetId;
    }

    it("creates an activity for a post and initializes its statistics target and gauge atomically", async () => {
        const userId = randomUUID();
        const postId = randomUUID();
        await ensurePost(postId, userId);

        const activity = await service.create({
            type: ActivityType.POST,
            sourceId: postId,
            profileUserId: userId,
        });

        expect(activity!.id).toBeDefined();
        expect(activity!.statisticsTargetId).toBeDefined();

        const storedActivity = await dataSource
            .getRepository(Activity)
            .findOneByOrFail({ id: activity!.id });
        expect(storedActivity.statisticsTargetId).toBe(activity!.statisticsTargetId);

        const target = await dataSource
            .getRepository(StatisticsTarget)
            .findOneByOrFail({ id: activity!.statisticsTargetId! });
        expect(target.sourceType).toBe(StatisticsSourceType.ACTIVITY);
        expect(target.isActive).toBe(true);

        const metric = await dataSource
            .getRepository(MetricTotal)
            .findOneByOrFail({
                targetId: activity!.statisticsTargetId!,
                metricCode: "likes_current",
            });
        expect(metric.metricValue).toBe(0);
    });

    it("rejects duplicate activity creation without leaking orphan targets", async () => {
        const userId = randomUUID();
        const postId = randomUUID();
        await ensurePost(postId, userId);

        const payload = {
            type: ActivityType.POST,
            sourceId: postId,
            profileUserId: userId,
        };

        const first = await service.create(payload);
        expect(first!.id).toBeDefined();

        const targetCountBefore = await dataSource.getRepository(StatisticsTarget).countBy({
            sourceType: StatisticsSourceType.ACTIVITY,
        });

        await expect(service.create(payload)).rejects.toThrow(UnrecoverableError);

        const targetCountAfter = await dataSource.getRepository(StatisticsTarget).countBy({
            sourceType: StatisticsSourceType.ACTIVITY,
        });
        expect(targetCountAfter).toBe(targetCountBefore);
    });

    it.each([
        { lockout: "an active suspension", banExpires: new Date(Date.now() + 60_000), rejected: true },
        { lockout: "a permanent ban", banExpires: null, rejected: true },
        { lockout: "an expired suspension", banExpires: new Date(Date.now() - 60_000), rejected: false },
    ])("with $lockout, rejects creation: $rejected", async ({ banExpires, rejected }) => {
        const userId = randomUUID();
        const postId = randomUUID();
        await ensurePost(postId, userId);
        const auth = lockoutAuthService([
            { id: userId, banned: true, banExpires },
        ]);
        getLockoutStates.mockImplementationOnce((ids: string[]) =>
            auth.getLockoutStates(ids),
        );

        const creation = service.create({
            type: ActivityType.POST,
            sourceId: postId,
            profileUserId: userId,
        });

        if (rejected) {
            await expect(creation).rejects.toThrow(
                new UnrecoverableError("User is suspended or banned."),
            );
        } else {
            expect((await creation)!.id).toBeDefined();
        }
    });

    it("hydrates a mixed page with profile.avatar, source relations, batched games, statistics, and strips pendingDelivery", async () => {
        const authorId = randomUUID();
        const viewerId = randomUUID();
        const followedUserId = randomUUID();
        await ensureProfile(authorId, true);
        await ensureProfile(viewerId);
        await ensureProfile(followedUserId);

        const baseId = Math.floor(Math.random() * 100_000_000) + 100_000;
        const gameA = baseId + 1;
        const gameB = baseId + 2;
        await ensureGameWithCover(gameA, "Game Alpha");
        await ensureGameWithCover(gameB, "Game Beta");

        const collectionId = randomUUID();
        const entryId = randomUUID();
        await dataSource.query(
            "INSERT INTO collection (id, name, isPublic, libraryUserId) VALUES (?, 'Favorites', 1, ?)",
            [collectionId, authorId],
        );
        await dataSource.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, status) VALUES (?, ?, ?, 'playing')",
            [entryId, gameA, authorId],
        );

        const reviewId = randomUUID();
        await dataSource.query(
            "INSERT INTO review (id, content, rating, gameId, profileUserId, collectionEntryId) VALUES (?, 'Great', 9.5, ?, ?, ?)",
            [reviewId, gameA, authorId, entryId],
        );

        const postId = randomUUID();
        await ensurePost(postId, authorId, gameB);

        const followRes = await dataSource.query(
            "INSERT INTO user_follow (followerUserId, followedUserId) VALUES (?, ?)",
            [authorId, followedUserId],
        );
        const followId = Number(followRes.insertId);

        const extGameId = baseId + 3;
        await dataSource.query(
            "INSERT INTO game_external_game (id, uid, category, gameId, origin) VALUES (?, ?, 1, ?, 'igdb')",
            [extGameId, `uid-${extGameId}`, gameB],
        );
        const ogActivityRes = await dataSource.query(
            "INSERT INTO obtained_game_achievement_activity (profileUserId, totalObtained, hasCompletedAllAchievements, hasObtainedPlatinumTrophy, pendingDelivery, externalGameId) VALUES (?, 3, 1, 0, 1, ?)",
            [authorId, extGameId],
        );
        const ogActivityId = Number(ogActivityRes.insertId);

        const achievementDefId = `ach_${randomUUID().slice(0, 12)}`;
        await dataSource.query(
            "INSERT INTO achievement_definition (id, name, description, category, metric, criteria, icon, isHidden, status) VALUES (?, 'Collector', 'Desc', 0, 'reviews_count', '{}', '{}', 0, 'published')",
            [achievementDefId],
        );
        const obtainedAchRes = await dataSource.query(
            "INSERT INTO obtained_achievement (achievementId, tier, profileUserId, isFeatured) VALUES (?, 2, ?, 0)",
            [achievementDefId, authorId],
        );
        const obtainedAchId = Number(obtainedAchRes.insertId);

        const postTargetId = await createStatsTarget(3, [viewerId]);
        const reviewTargetId = await createStatsTarget(1, []);

        const activityRepo = dataSource.getRepository(Activity);
        const t0 = Date.now() - 10_000;
        const seeded = await activityRepo.save([
            activityRepo.create({
                type: ActivityType.COLLECTION_ENTRY,
                profileUserId: authorId,
                collectionEntryId: entryId,
                collectionId,
                statisticsTargetId: null,
                createdAt: new Date(t0 + 1000),
            }),
            activityRepo.create({
                type: ActivityType.REVIEW,
                profileUserId: authorId,
                reviewId,
                statisticsTargetId: reviewTargetId,
                createdAt: new Date(t0 + 2000),
            }),
            activityRepo.create({
                type: ActivityType.POST,
                profileUserId: authorId,
                postId,
                statisticsTargetId: postTargetId,
                createdAt: new Date(t0 + 3000),
            }),
            activityRepo.create({
                type: ActivityType.FOLLOW,
                profileUserId: authorId,
                userFollowId: followId,
                statisticsTargetId: null,
                createdAt: new Date(t0 + 4000),
            }),
            activityRepo.create({
                type: ActivityType.OBTAINED_GAME_ACHIEVEMENT,
                profileUserId: authorId,
                obtainedGameAchievementActivityId: ogActivityId,
                statisticsTargetId: null,
                createdAt: new Date(t0 + 5000),
            }),
            activityRepo.create({
                type: ActivityType.ACHIEVEMENT_UNLOCKED,
                profileUserId: authorId,
                obtainedAchievementId: obtainedAchId,
                statisticsTargetId: null,
                createdAt: new Date(t0 + 6000),
            }),
        ]);

        const targetCountBefore = await dataSource
            .getRepository(StatisticsTarget)
            .count();
        const stateCountBefore = await dataSource
            .getRepository(EngagementState)
            .count();

        findAllByIds.mockClear();

        const [items, total] = await service.findLatestBy(
            { where: { profileUserId: authorId }, take: 10 },
            viewerId,
        );

        expect(total).toBe(6);
        expect(items).toHaveLength(6);
        expect(findAllByIds).toHaveBeenCalledTimes(1);
        expect(findAllByIds).toHaveBeenCalledWith({
            gameIds: expect.arrayContaining([gameA, gameB]),
            relations: { cover: true },
        });
        expect(findAllByIds.mock.calls[0][0].gameIds).toHaveLength(2);

        const byType = new Map(items.map((item) => [item.type, item]));

        const collectionItem = byType.get(ActivityType.COLLECTION_ENTRY)!;
        expect(collectionItem.profile.avatar).toBeDefined();
        expect(collectionItem.profile.avatar?.filename).toContain("avatar_");
        expect(collectionItem.collectionEntry?.gameId).toBe(gameA);
        expect(collectionItem.collection?.id).toBe(collectionId);
        expect(collectionItem.game?.id).toBe(gameA);
        expect(collectionItem.game?.cover?.imageId).toBe(`cov_${gameA}`);
        expect(collectionItem.statistics).toEqual({
            likesCount: 0,
            isLiked: false,
        });

        const reviewItem = byType.get(ActivityType.REVIEW)!;
        expect(reviewItem.review?.rating).toBe(9.5);
        expect(reviewItem.post).toBeNull();
        expect(reviewItem.collectionEntry).toBeNull();
        expect(reviewItem.obtainedGameAchievementActivity).toBeNull();
        expect(reviewItem.game?.id).toBe(gameA);
        expect(reviewItem.statistics).toEqual({
            likesCount: 1,
            isLiked: false,
        });

        const postItem = byType.get(ActivityType.POST)!;
        expect(postItem.post?.id).toBe(postId);
        expect(postItem.game?.id).toBe(gameB);
        expect(postItem.game?.cover?.imageId).toBe(`cov_${gameB}`);
        expect(postItem.statistics).toEqual({
            likesCount: 3,
            isLiked: true,
        });

        const followItem = byType.get(ActivityType.FOLLOW)!;
        expect(followItem.userFollow?.followedUserId).toBe(followedUserId);
        expect(followItem.game).toBeNull();

        const gameAchItem = byType.get(ActivityType.OBTAINED_GAME_ACHIEVEMENT)!;
        expect(gameAchItem.obtainedGameAchievementActivity?.totalObtained).toBe(3);
        expect(gameAchItem.obtainedGameAchievementActivity?.externalGame?.gameId).toBe(gameB);
        expect("pendingDelivery" in gameAchItem.obtainedGameAchievementActivity!).toBe(false);
        expect(gameAchItem.game?.id).toBe(gameB);

        const platformAchItem = byType.get(ActivityType.ACHIEVEMENT_UNLOCKED)!;
        expect(platformAchItem.obtainedAchievement?.tier).toBe(2);
        expect(platformAchItem.obtainedAchievement?.definition?.name).toBe("Collector");
        expect(platformAchItem.game).toBeNull();

        // Anonymous call returns isLiked: false while keeping likesCount
        const [anonItems] = await service.findLatestBy({
            where: { profileUserId: authorId },
            take: 10,
        });
        const anonPost = anonItems.find((i) => i.type === ActivityType.POST)!;
        expect(anonPost.statistics).toEqual({ likesCount: 3, isLiked: false });

        // findOneByOrFail hydrates with viewer vs anonymous
        const detailAuthed = await service.findOneByOrFail(
            { where: { id: postItem.id } },
            viewerId,
        );
        expect(detailAuthed.statistics).toEqual({ likesCount: 3, isLiked: true });
        expect(detailAuthed.game?.id).toBe(gameB);

        const detailAnon = await service.findOneByOrFail({
            where: { id: gameAchItem.id },
        });
        expect("pendingDelivery" in detailAnon.obtainedGameAchievementActivity!).toBe(false);
        expect(detailAnon.statistics).toEqual({ likesCount: 0, isLiked: false });

        const [onlyGameAch] = await service.findLatest(
            { userId: authorId, type: ActivityType.OBTAINED_GAME_ACHIEVEMENT },
            viewerId,
        );
        expect(onlyGameAch).toHaveLength(1);
        expect(onlyGameAch[0].obtainedGameAchievementActivity?.externalGame?.gameId).toBe(gameB);
        expect(onlyGameAch[0].game?.id).toBe(gameB);
        expect("pendingDelivery" in onlyGameAch[0].obtainedGameAchievementActivity!).toBe(false);

        // Read-only guarantee: no statistics rows written
        expect(await dataSource.getRepository(StatisticsTarget).count()).toBe(targetCountBefore);
        expect(await dataSource.getRepository(EngagementState).count()).toBe(stateCountBefore);
    });

    it("embeds private collections only for their owner on lists and details", async () => {
        const ownerId = randomUUID();
        const otherId = randomUUID();
        await ensureProfile(ownerId);
        await ensureProfile(otherId);
        const entryId = randomUUID();
        await dataSource.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, status) VALUES (?, 1, ?, 'playing')",
            [entryId, ownerId],
        );
        const activities: Activity[] = [];
        for (const isPublic of [false, true]) {
            const collectionId = randomUUID();
            await dataSource.query(
                "INSERT INTO collection (id, name, isPublic, libraryUserId) VALUES (?, 'Collection metadata', ?, ?)",
                [collectionId, isPublic, ownerId],
            );
            activities.push(await dataSource.getRepository(Activity).save({
                type: ActivityType.COLLECTION_ENTRY,
                profileUserId: ownerId,
                collectionEntryId: entryId,
                collectionId,
            }));
        }

        for (const viewerId of [ownerId, otherId, undefined]) {
            const [items, count] = await service.findLatestBy(
                { where: { profileUserId: ownerId } },
                viewerId,
            );
            expect(count).toBe(2);
            for (const [index, activity] of activities.entries()) {
                const detail = await service.findOneByOrFail(
                    { where: { id: activity.id } },
                    viewerId,
                );
                for (const item of [items.find((item) => item.id === activity.id)!, detail]) {
                    expect(item.collectionId).toBe(activity.collectionId);
                    expect(item.collectionEntry?.id).toBe(entryId);
                    if (index === 1 || viewerId === ownerId) {
                        expect(item.collection?.id).toBe(activity.collectionId);
                    } else {
                        expect(item.collection).toBeNull();
                    }
                }
            }
        }
    });

    it("executes the same number of queries for take: 2 and take: 10", async () => {
        const authorId = randomUUID();
        const viewerId = randomUUID();
        await ensureProfile(authorId, true);
        await ensureProfile(viewerId);

        const baseId = Math.floor(Math.random() * 100_000_000) + 200_000;
        const gameId = baseId + 1;
        await ensureGameWithCover(gameId, "Bounded Game");

        const activityRepo = dataSource.getRepository(Activity);
        const t0 = Date.now() - 20_000;
        for (let i = 0; i < 10; i++) {
            const targetId = await createStatsTarget(i, i % 2 === 0 ? [viewerId] : []);
            if (i % 2 === 0) {
                const postId = randomUUID();
                await ensurePost(postId, authorId, gameId);
                await activityRepo.save(
                    activityRepo.create({
                        type: ActivityType.POST,
                        profileUserId: authorId,
                        postId,
                        statisticsTargetId: targetId,
                        createdAt: new Date(t0 + i * 1000),
                    }),
                );
            } else {
                const entryId = randomUUID();
                const reviewId = randomUUID();
                await dataSource.query(
                    "INSERT INTO collection_entry (id, gameId, libraryUserId, status) VALUES (?, ?, ?, 'playing')",
                    [entryId, gameId, authorId],
                );
                await dataSource.query(
                    "INSERT INTO review (id, content, rating, gameId, profileUserId, collectionEntryId) VALUES (?, 'Review', 8, ?, ?, ?)",
                    [reviewId, gameId, authorId, entryId],
                );
                await activityRepo.save(
                    activityRepo.create({
                        type: ActivityType.REVIEW,
                        profileUserId: authorId,
                        reviewId,
                        statisticsTargetId: targetId,
                        createdAt: new Date(t0 + i * 1000),
                    }),
                );
            }
        }

        const runner = dataSource.createQueryRunner();
        const runnerProto = Object.getPrototypeOf(runner);
        await runner.release();
        const querySpy = jest.spyOn(runnerProto, "query");

        try {
            querySpy.mockClear();
            const [page2] = await service.findLatestBy(
                { where: { profileUserId: authorId }, take: 2 },
                viewerId,
            );
            const queriesFor2 = querySpy.mock.calls.length;
            expect(page2).toHaveLength(2);

            querySpy.mockClear();
            const [page10] = await service.findLatestBy(
                { where: { profileUserId: authorId }, take: 10 },
                viewerId,
            );
            const queriesFor10 = querySpy.mock.calls.length;
            expect(page10).toHaveLength(10);

            expect(queriesFor10).toBe(queriesFor2);
        } finally {
            querySpy.mockRestore();
        }
    });

    it("skips findAllByIds when no game ids exist and treats 404 from findAllByIds as null games", async () => {
        const authorId = randomUUID();
        const followedId = randomUUID();
        await ensureProfile(authorId);
        await ensureProfile(followedId);

        const followRes = await dataSource.query(
            "INSERT INTO user_follow (followerUserId, followedUserId) VALUES (?, ?)",
            [authorId, followedId],
        );
        await dataSource.getRepository(Activity).save(
            dataSource.getRepository(Activity).create({
                type: ActivityType.FOLLOW,
                profileUserId: authorId,
                userFollowId: Number(followRes.insertId),
                statisticsTargetId: null,
            }),
        );

        findAllByIds.mockClear();
        const [followOnly] = await service.findLatestBy({
            where: { profileUserId: authorId },
            take: 5,
        });
        expect(followOnly).toHaveLength(1);
        expect(followOnly[0].game).toBeNull();
        expect(findAllByIds).not.toHaveBeenCalled();

        const postAuthorId = randomUUID();
        const postId = randomUUID();
        await ensurePost(postId, postAuthorId, 1);
        await dataSource.getRepository(Activity).save(
            dataSource.getRepository(Activity).create({
                type: ActivityType.POST,
                profileUserId: postAuthorId,
                postId,
                statisticsTargetId: null,
            }),
        );

        findAllByIds.mockRejectedValueOnce(
            new HttpException("No games match provided ids", HttpStatus.NOT_FOUND),
        );
        const [missingGameItems] = await service.findLatestBy({
            where: { profileUserId: postAuthorId },
            take: 5,
        });
        expect(missingGameItems).toHaveLength(1);
        expect(missingGameItems[0].game).toBeNull();
    });
});
