import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { StatisticsGranularity, StatisticsMetricCode } from "./dto/statistics-api.dto";
import { StatisticsSourceType } from "./statistics.constants";
import { ensureStatisticsTarget } from "./statistics-target.repository";
import { StatisticsService } from "./statistics.service";
import { StatisticsRankingService } from "./statistics-ranking.service";

describe("statistics source API coverage", () => {
    let dataSource: DataSource;
    let service: StatisticsService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new StatisticsService(dataSource);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it("serves summaries, anonymous status, and series for all seven native source kinds", async () => {
        const owner = randomUUID();
        const postId = randomUUID();
        const reviewId = randomUUID();
        const activityId = randomUUID();
        const reviewCommentId = randomUUID();
        const activityCommentId = randomUUID();
        const postCommentId = randomUUID();
        const entryId = randomUUID();
        const gameId = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [owner, `u_${owner.slice(0, 16)}`],
        );
        await dataSource.query(
            "INSERT INTO game (id, name, slug) VALUES (?, 'Source API fixture', ?)",
            [gameId, `source-api-${gameId}`],
        );
        await dataSource.query("INSERT IGNORE INTO library (userId) VALUES (?)", [owner]);
        await dataSource.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, status) VALUES (?, ?, ?, 'planned')",
            [entryId, gameId, owner],
        );
        await dataSource.query(
            "INSERT INTO review (id, gameId, profileUserId, collectionEntryId, rating) VALUES (?, ?, ?, ?, 4)",
            [reviewId, gameId, owner, entryId],
        );
        await dataSource.query(
            "INSERT INTO post (id, profileUserId, gameId, content) VALUES (?, ?, ?, 'Source API fixture')",
            [postId, owner, gameId],
        );
        await dataSource.query(
            "INSERT INTO activity (id, type, profileUserId, postId) VALUES (?, 'POST', ?, ?)",
            [activityId, owner, postId],
        );
        await dataSource.query(
            "INSERT INTO review_comment (id, profileUserId, reviewId, content) VALUES (?, ?, ?, 'Review comment')",
            [reviewCommentId, owner, reviewId],
        );
        await dataSource.query(
            "INSERT INTO activity_comment (id, profileUserId, activityId, content) VALUES (?, ?, ?, 'Activity comment')",
            [activityCommentId, owner, activityId],
        );
        await dataSource.query(
            "INSERT INTO post_comment (id, profileUserId, postId, content) VALUES (?, ?, ?, 'Post comment')",
            [postCommentId, owner, postId],
        );
        const sources = [
            { sourceType: StatisticsSourceType.GAME, sourceId: gameId },
            { sourceType: StatisticsSourceType.REVIEW, sourceId: reviewId },
            { sourceType: StatisticsSourceType.ACTIVITY, sourceId: activityId },
            { sourceType: StatisticsSourceType.POST, sourceId: postId },
            { sourceType: StatisticsSourceType.REVIEW_COMMENT, sourceId: reviewCommentId },
            { sourceType: StatisticsSourceType.ACTIVITY_COMMENT, sourceId: activityCommentId },
            { sourceType: StatisticsSourceType.POST_COMMENT, sourceId: postCommentId },
        ] as const;

        for (const source of sources) {
            await dataSource.transaction((manager) =>
                ensureStatisticsTarget(manager, source.sourceType, source.sourceId),
            );
        }

        for (const source of sources) {
            await expect(service.findSummary(source)).resolves.toMatchObject({
                ...source,
                viewsCount: 0,
                likesCount: 0,
                historyComplete: true,
                completeSince: null,
            });
            await expect(service.getStatus(source)).resolves.toEqual({ isLiked: false, isViewed: false });
            await expect(service.findSeries({
                ...source,
                metric: StatisticsMetricCode.VIEWS,
                granularity: StatisticsGranularity.HOUR,
                from: "2024-05-01T10:00:00Z",
                to: "2024-05-01T11:00:00Z",
            })).resolves.toMatchObject({
                sourceType: source.sourceType,
                sourceId: source.sourceId,
                buckets: [{ start: "2024-05-01T10:00:00.000Z", value: 0 }],
                historyComplete: true,
            });
        }

        const collectionId = randomUUID();
        await dataSource.query(
            "INSERT INTO collection (id, name, isPublic, libraryUserId) VALUES (?, 'Source API visibility', 1, ?)",
            [collectionId, owner],
        );
        await dataSource.query(
            "INSERT INTO collection_entry_collections_collection (collectionEntryId, collectionId) VALUES (?, ?)",
            [entryId, collectionId],
        );
        const cacheValues = new Map<string, any>();
        const rankings = new StatisticsRankingService(dataSource, {
            get: async (key: string) => cacheValues.get(key),
            set: async (key: string, value: any) => { cacheValues.set(key, value); },
        } as any);
        const rankingRequest = {
            sourceType: StatisticsSourceType.REVIEW,
            mode: "popular",
            period: "all",
            gameId,
            authorId: owner,
        } as any;
        expect((await rankings.findRankings(owner, rankingRequest)).pagination.total).toBe(1);

        const runner = dataSource.createQueryRunner();
        await runner.connect();
        await runner.startTransaction();
        try {
            await runner.query("SELECT id FROM collection WHERE id = ? FOR UPDATE", [collectionId]);
            const pendingRead = service.findSummary({ sourceType: StatisticsSourceType.REVIEW, sourceId: reviewId });
            await runner.query("UPDATE collection SET isPublic = 0 WHERE id = ?", [collectionId]);
            await runner.commitTransaction();
            await expect(pendingRead).rejects.toThrow(NotFoundException);
        } catch (error) {
            if (runner.isTransactionActive) await runner.rollbackTransaction();
            throw error;
        } finally {
            await runner.release();
        }
        const privatePage = await rankings.findRankings(owner, rankingRequest);
        expect(privatePage.pagination.total).toBe(0);
        expect(privatePage.items).toEqual([]);
        await dataSource.query("UPDATE collection SET isPublic = 1 WHERE id = ?", [collectionId]);
        expect((await rankings.findRankings(owner, rankingRequest)).pagination.total).toBe(1);
    });
});
