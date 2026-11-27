import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import {
    createLibraryAccessService,
    createNotificationTestDataSource,
} from "../../test/notifications/notification-test-harness";
import { StatisticsService } from "./statistics.service";
import { StatisticsSourceType } from "./statistics.constants";
import { ensureStatisticsTarget } from "./statistics-target.repository";

describe("statistics comment counts and batch summaries", () => {
    let dataSource: DataSource;
    let service: StatisticsService;
    let gameId: number;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new StatisticsService(
            dataSource,
            createLibraryAccessService(dataSource),
        );
        gameId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        await dataSource.query(
            "INSERT INTO game (id, name, slug) VALUES (?, 'Batch statistics fixture', ?)",
            [gameId, `batch-statistics-${gameId}`],
        );
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    async function createProfile(libraryVisibility = "public") {
        const userId = randomUUID();
        await dataSource.query(
            `INSERT INTO profile (userId, username, libraryVisibility, createdAt, updatedAt)
            VALUES (?, ?, ?, NOW(), NOW())`,
            [userId, `u_${userId.slice(0, 16)}`, libraryVisibility],
        );
        await dataSource.query("INSERT IGNORE INTO library (userId) VALUES (?)", [userId]);
        return userId;
    }

    async function createEntry(ownerId: string, visibility = "public") {
        const entryId = randomUUID();
        await dataSource.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, status, visibility) VALUES (?, ?, ?, 'planned', ?)",
            [entryId, gameId, ownerId, visibility],
        );
        return entryId;
    }

    async function createReview(ownerId: string, entryId: string) {
        const reviewId = randomUUID();
        await dataSource.query(
            "INSERT INTO review (id, gameId, profileUserId, collectionEntryId, rating) VALUES (?, ?, ?, ?, 4)",
            [reviewId, gameId, ownerId, entryId],
        );
        return reviewId;
    }

    async function createPost(ownerId: string) {
        const postId = randomUUID();
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, ?, 'Batch statistics fixture')",
            [postId, ownerId, gameId],
        );
        return postId;
    }

    async function createActivity(
        ownerId: string,
        column: "postId" | "collectionEntryId",
        sourceId: string,
    ) {
        const activityId = randomUUID();
        await dataSource.query(
            `INSERT INTO activity (id, type, profileUserId, ${column}) VALUES (?, ?, ?, ?)`,
            [activityId, column === "postId" ? "POST" : "COLLECTION_ENTRY", ownerId, sourceId],
        );
        return activityId;
    }

    async function createComment(
        table: "review_comment" | "post_comment" | "activity_comment",
        column: "reviewId" | "postId" | "activityId",
        sourceId: string,
        authorId: string,
        childOfId: string | null = null,
    ) {
        const commentId = randomUUID();
        await dataSource.query(
            `INSERT INTO ${table} (id, profileUserId, ${column}, content, childOfId) VALUES (?, ?, ?, 'fixture', ?)`,
            [commentId, authorId, sourceId, childOfId],
        );
        return commentId;
    }

    async function createTarget(sourceType: StatisticsSourceType, sourceId: string | number) {
        return dataSource.transaction((manager) =>
            ensureStatisticsTarget(manager, sourceType, sourceId),
        );
    }

    async function setMetrics(targetId: number, views: number, likes: number) {
        await dataSource.query(
            `INSERT INTO metric_total (targetId, metricCode, metricValue) VALUES (?, 'views', ?)
            ON DUPLICATE KEY UPDATE metricValue = VALUES(metricValue)`,
            [targetId, views],
        );
        await dataSource.query(
            `INSERT INTO metric_total (targetId, metricCode, metricValue) VALUES (?, 'likes_current', ?)
            ON DUPLICATE KEY UPDATE metricValue = VALUES(metricValue)`,
            [targetId, likes],
        );
    }

    async function reviewTargetCount() {
        const [row] = await dataSource.query(
            "SELECT COUNT(*) AS total FROM statistics_target WHERE sourceType = 'review'",
        );
        return Number(row.total);
    }

    it("counts top-level comments and replies in summaries and reports zero for non-commentables", async () => {
        const owner = await createProfile();
        const entryId = await createEntry(owner);
        const reviewId = await createReview(owner, entryId);
        const reviewTarget = (await createTarget(StatisticsSourceType.REVIEW, reviewId))!;
        await setMetrics(reviewTarget, 12, 3);
        const topLevel = await createComment("review_comment", "reviewId", reviewId, owner);
        await createComment("review_comment", "reviewId", reviewId, owner);
        for (let index = 0; index < 3; index++)
            await createComment("review_comment", "reviewId", reviewId, owner, topLevel);

        await expect(
            service.findSummary({
                sourceType: StatisticsSourceType.REVIEW,
                sourceId: reviewId,
            }),
        ).resolves.toMatchObject({
            sourceType: StatisticsSourceType.REVIEW,
            sourceId: reviewId,
            viewsCount: 12,
            likesCount: 3,
            commentsCount: 5,
        });

        const activityId = await createActivity(owner, "collectionEntryId", entryId);
        const activityTarget = (await createTarget(
            StatisticsSourceType.ACTIVITY,
            activityId,
        ))!;
        await setMetrics(activityTarget, 3, 1);
        const activityComment = await createComment(
            "activity_comment",
            "activityId",
            activityId,
            owner,
        );
        await createComment(
            "activity_comment",
            "activityId",
            activityId,
            owner,
            activityComment,
        );
        await expect(
            service.findSummary({
                sourceType: StatisticsSourceType.ACTIVITY,
                sourceId: activityId,
            }),
        ).resolves.toMatchObject({ viewsCount: 3, likesCount: 1, commentsCount: 2 });

        const postId = await createPost(owner);
        const postTarget = (await createTarget(StatisticsSourceType.POST, postId))!;
        await setMetrics(postTarget, 2, 1);
        const postComment = await createComment("post_comment", "postId", postId, owner);
        await createComment("post_comment", "postId", postId, owner, postComment);
        await expect(
            service.findSummary({
                sourceType: StatisticsSourceType.POST,
                sourceId: postId,
            }),
        ).resolves.toMatchObject({ viewsCount: 2, likesCount: 1, commentsCount: 2 });

        await expect(
            service.findSummary({ sourceType: StatisticsSourceType.GAME, sourceId: gameId }),
        ).resolves.toMatchObject({
            viewsCount: 0,
            likesCount: 0,
            commentsCount: 0,
        });
        await createTarget(StatisticsSourceType.REVIEW_COMMENT, topLevel);
        await expect(
            service.findSummary({
                sourceType: StatisticsSourceType.REVIEW_COMMENT,
                sourceId: topLevel,
            }),
        ).resolves.toMatchObject({ commentsCount: 0 });
        await expect(
            service.findBatchSummary({
                sourceType: StatisticsSourceType.REVIEW_COMMENT,
                sourceIds: [topLevel],
            }),
        ).resolves.toMatchObject({
            items: [{ sourceType: StatisticsSourceType.REVIEW_COMMENT, sourceId: topLevel, commentsCount: 0 }],
        });
        await expect(
            service.findBatchSummary({
                sourceType: StatisticsSourceType.GAME,
                sourceIds: [gameId],
            }),
        ).resolves.toMatchObject({
            items: [
                {
                    sourceType: StatisticsSourceType.GAME,
                    sourceId: gameId,
                    viewsCount: 0,
                    likesCount: 0,
                    commentsCount: 0,
                    isLiked: false,
                    isViewed: false,
                },
            ],
        });
    });

    it("returns batch counts and viewer flags while omitting missing sources without creating targets", async () => {
        const owner = await createProfile();
        const viewer = await createProfile();
        const firstReviewId = await createReview(owner, await createEntry(owner));
        const secondReviewId = await createReview(owner, await createEntry(owner));
        const firstTarget = (await createTarget(StatisticsSourceType.REVIEW, firstReviewId))!;
        const secondTarget = (await createTarget(StatisticsSourceType.REVIEW, secondReviewId))!;
        await setMetrics(firstTarget, 10, 4);
        await setMetrics(secondTarget, 7, 2);
        await createComment("review_comment", "reviewId", firstReviewId, owner);
        await createComment("review_comment", "reviewId", firstReviewId, owner);
        await dataSource.query(
            `INSERT INTO engagement_state (targetId, profileUserId, likedAt, lastViewedAt)
            VALUES (?, ?, NOW(), NOW())
            ON DUPLICATE KEY UPDATE likedAt = VALUES(likedAt), lastViewedAt = VALUES(lastViewedAt)`,
            [firstTarget, viewer],
        );
        await dataSource.query(
            `INSERT INTO engagement_state (targetId, profileUserId, lastViewedAt)
            VALUES (?, ?, NOW())
            ON DUPLICATE KEY UPDATE lastViewedAt = VALUES(lastViewedAt)`,
            [secondTarget, viewer],
        );
        const missingReviewId = randomUUID();
        const legacyReviewId = await createReview(owner, await createEntry(owner));
        const targetsBefore = await reviewTargetCount();

        const batch = await service.findBatchSummary(
            {
                sourceType: StatisticsSourceType.REVIEW,
                sourceIds: [
                    firstReviewId,
                    missingReviewId,
                    secondReviewId,
                    firstReviewId.toUpperCase(),
                ],
            },
            viewer,
        );

        expect(batch.items).toHaveLength(2);
        expect(batch.items[0]).toMatchObject({
            sourceType: StatisticsSourceType.REVIEW,
            sourceId: firstReviewId,
            viewsCount: 10,
            likesCount: 4,
            commentsCount: 2,
            isLiked: true,
            isViewed: true,
        });
        expect(batch.items[1]).toMatchObject({
            sourceId: secondReviewId,
            viewsCount: 7,
            likesCount: 2,
            commentsCount: 0,
            isLiked: false,
            isViewed: true,
        });
        expect(batch.asOf).toEqual(expect.any(String));
        expect(typeof batch.projectionLagSeconds).toBe("number");
        expect(batch.historyComplete).toBe(true);
        expect(batch.completeSince).toBeNull();

        const anonymous = await service.findBatchSummary({
            sourceType: StatisticsSourceType.REVIEW,
            sourceIds: [firstReviewId, secondReviewId],
        });
        expect(anonymous.items.map((item) => [item.isLiked, item.isViewed])).toEqual([
            [false, false],
            [false, false],
        ]);

        const legacy = await service.findBatchSummary({
            sourceType: StatisticsSourceType.REVIEW,
            sourceIds: [legacyReviewId],
        });
        expect(legacy.items).toEqual([
            {
                sourceType: StatisticsSourceType.REVIEW,
                sourceId: legacyReviewId,
                viewsCount: 0,
                likesCount: 0,
                commentsCount: 0,
                isLiked: false,
                isViewed: false,
            },
        ]);
        expect(await reviewTargetCount()).toBe(targetsBefore);
        expect(
            (
                await dataSource.query("SELECT statisticsTargetId FROM review WHERE id = ?", [
                    legacyReviewId,
                ])
            )[0].statisticsTargetId,
        ).toBeNull();
    });

    it("omits private activities and includes followers entries inside public libraries", async () => {
        const owner = await createProfile();
        const follower = await createProfile();
        const stranger = await createProfile();
        await dataSource.query(
            `INSERT INTO user_follow (followerUserId, followedUserId, createdAt, updatedAt)
            VALUES (?, ?, NOW(), NOW())`,
            [follower, owner],
        );
        const publicActivity = await createActivity(
            owner,
            "collectionEntryId",
            await createEntry(owner, "public"),
        );
        const followersActivity = await createActivity(
            owner,
            "collectionEntryId",
            await createEntry(owner, "followers"),
        );
        const privateActivity = await createActivity(
            owner,
            "collectionEntryId",
            await createEntry(owner, "private"),
        );
        for (const activityId of [publicActivity, followersActivity, privateActivity])
            await createTarget(StatisticsSourceType.ACTIVITY, activityId);
        const activityIds = [publicActivity, followersActivity, privateActivity];
        const readableBy = async (userId?: string) => {
            const response = await service.findBatchSummary(
                { sourceType: StatisticsSourceType.ACTIVITY, sourceIds: activityIds },
                userId,
            );
            return response.items.map((item) => item.sourceId);
        };

        await expect(readableBy(owner)).resolves.toEqual(activityIds);
        await expect(readableBy(follower)).resolves.toEqual([
            publicActivity,
            followersActivity,
        ]);
        await expect(readableBy(stranger)).resolves.toEqual([publicActivity]);
        await expect(readableBy()).resolves.toEqual([publicActivity]);
        await expect(
            service.findSummary(
                { sourceType: StatisticsSourceType.ACTIVITY, sourceId: privateActivity },
                owner,
            ),
        ).resolves.toMatchObject({ sourceId: privateActivity, commentsCount: 0 });
        await expect(
            service.findSummary({
                sourceType: StatisticsSourceType.ACTIVITY,
                sourceId: privateActivity,
            }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("reads single summaries without row locks or target creation", async () => {
        const owner = await createProfile();
        const entryId = await createEntry(owner);
        const reviewId = await createReview(owner, entryId);
        const querySpy = jest.spyOn(dataSource.manager, "query");
        try {
            await expect(
                service.findSummary({
                    sourceType: StatisticsSourceType.REVIEW,
                    sourceId: reviewId,
                }),
            ).resolves.toMatchObject({
                viewsCount: 0,
                likesCount: 0,
                commentsCount: 0,
            });
        } finally {
            querySpy.mockRestore();
        }
        const statements = querySpy.mock.calls.map(([statement]) => String(statement));
        expect(statements.some((statement) => /FOR UPDATE/i.test(statement))).toBe(false);
        expect(
            statements.some((statement) => /INSERT INTO statistics_target/i.test(statement)),
        ).toBe(false);
        expect(
            (
                await dataSource.query("SELECT statisticsTargetId FROM review WHERE id = ?", [
                    reviewId,
                ])
            )[0].statisticsTargetId,
        ).toBeNull();
    });

    it("throws 404 for missing sources", async () => {
        await expect(
            service.findSummary({
                sourceType: StatisticsSourceType.REVIEW,
                sourceId: randomUUID(),
            }),
        ).rejects.toBeInstanceOf(NotFoundException);
    });
});
