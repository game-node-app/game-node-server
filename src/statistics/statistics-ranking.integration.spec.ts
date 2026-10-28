import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { createCache } from "cache-manager";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { StatisticsSourceType } from "./statistics.constants";
import { MATURE_THEME_ID } from "../game/game-filter/game-filter.constants";
import { ensureStatisticsTarget } from "./statistics-target.repository";

describe("statistics rankings", () => {
    let dataSource: DataSource;
    let service: StatisticsRankingService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        service = new StatisticsRankingService(dataSource);
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    async function createGame(id: number) {
        await dataSource.query("INSERT INTO game (id, name, slug) VALUES (?, ?, ?)", [id, `Ranking ${id}`, `ranking-${id}`]);
        return dataSource.transaction(async (manager) =>
            Number(await ensureStatisticsTarget(manager, StatisticsSourceType.GAME, id)),
        );
    }

    async function setMetric(targetId: number, code: string, value: number) {
        await dataSource.query(
            `INSERT INTO metric_total (targetId, metricCode, metricValue) VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE metricValue = VALUES(metricValue)`,
            [targetId, code, value],
        );
    }

    async function createReview(gameId: number, owner: string, isPublic: boolean, score: number) {
        const collectionId = randomUUID();
        const entryId = randomUUID();
        const reviewId = randomUUID();
        await dataSource.query(
            "INSERT IGNORE INTO profile (userId, username, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())",
            [owner, `u_${owner.slice(0, 16)}`],
        );
        await dataSource.query("INSERT IGNORE INTO library (userId) VALUES (?)", [owner]);
        await dataSource.query(
            "INSERT INTO collection (id, name, isPublic, libraryUserId) VALUES (?, ?, ?, ?)",
            [collectionId, `ranking-${collectionId}`, isPublic ? 1 : 0, owner],
        );
        await dataSource.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, status) VALUES (?, ?, ?, 'planned')",
            [entryId, gameId, owner],
        );
        await dataSource.query(
            "INSERT INTO collection_entry_collections_collection (collectionEntryId, collectionId) VALUES (?, ?)",
            [entryId, collectionId],
        );
        await dataSource.query(
            "INSERT INTO review (id, gameId, profileUserId, collectionEntryId, rating) VALUES (?, ?, ?, ?, 4)",
            [reviewId, gameId, owner, entryId],
        );
        const targetId = await dataSource.transaction((manager) =>
            ensureStatisticsTarget(manager, StatisticsSourceType.REVIEW, reviewId),
        );
        await setMetric(Number(targetId), "views", score);
        return reviewId;
    }

    it("filters games in SQL before paging, excludes mature games, and retains zero-score ties", async () => {
        const firstId = 2_000_000_000 - randomInt(100_000);
        const zeroId = firstId + 1;
        const matureId = firstId + 2;
        const tiedId = firstId + 3;
        const targets = new Map<number, number>();
        for (const id of [firstId, zeroId, tiedId, matureId]) targets.set(id, await createGame(id));
        await setMetric(targets.get(firstId)!, "views", 10);
        const themeId = randomInt(1_000_000, 2_000_000_000);
        await dataSource.query(
            "INSERT IGNORE INTO game_theme (id, name, slug) VALUES (?, 'Mature', 'mature'), (?, ?, ?)",
            [MATURE_THEME_ID, themeId, `Adventure ${themeId}`, `adventure-${themeId}`],
        );
        await dataSource.query(
            "INSERT INTO game_themes_game_theme (gameId, gameThemeId) VALUES (?, ?), (?, ?)",
            [zeroId, themeId, matureId, MATURE_THEME_ID],
        );

        const page = await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: "popular" as any,
            period: "all",
            criteria: { ids: [firstId, zeroId, tiedId, matureId], themes: [themeId] } as any,
            limit: 10,
            offset: 0,
        });
        expect(page.pagination.total).toBe(1);
        expect(page.items.map((item: any) => item.sourceId)).toEqual([zeroId]);

        const allGames = await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: "popular" as any,
            period: "all",
            criteria: { ids: [zeroId, tiedId, matureId] } as any,
            limit: 20,
            offset: 0,
        });
        expect(allGames.items.map((item: any) => item.sourceId)).toEqual([zeroId, tiedId]);
        expect(allGames.items.map((item: any) => item.score)).toEqual([0, 0]);
    });

    it("pages across positive scores, zero scores and games missing from the prepared key in native ID order", async () => {
        const firstId = 2_050_000_000 - randomInt(100_000);
        const ids = Array.from({ length: 5 }, (_, index) => firstId + index);
        const targets = new Map<number, number>();
        for (const id of [...ids].reverse()) targets.set(id, await createGame(id));
        for (const [index, score] of [[0, 2], [1, 9], [2, 0], [4, 9]]) {
            await dataSource.query(
                `INSERT INTO ranking_score (rankingKey, targetId, score, definitionVersion, computedAt)
                 VALUES ('game:popular:month', ?, ?, 'engagement-v1', CURRENT_TIMESTAMP(6))`,
                [targets.get(ids[index]), score],
            );
        }
        await setMetric(targets.get(ids[3])!, "views", 123);
        await setMetric(targets.get(ids[3])!, "likes_current", 7);
        const expected = [ids[1], ids[4], ids[0], ids[2], ids[3]];
        for (const offset of [0, 1, 2, 3, 4, 5, 10000]) {
            const page = await service.findRankings(undefined, {
                sourceType: StatisticsSourceType.GAME,
                mode: "popular" as any,
                period: "month",
                criteria: { ids } as any,
                limit: 2,
                offset,
            });
            expect(page.items.map((item: any) => item.sourceId)).toEqual(expected.slice(offset, offset + 2));
            expect(page.pagination).toEqual({ total: 5, limit: 2, offset, hasNextPage: offset + 2 < 5 });
            const missing = page.items.find((item: any) => item.sourceId === ids[3]);
            if (missing) expect(missing).toMatchObject({ score: 0, viewsCount: 123, likesCount: 7 });
        }
        const genreId = randomInt(1_000_000, 2_000_000_000);
        for (const id of [genreId, genreId + 1])
            await dataSource.query("INSERT INTO game_genre (id, name, slug) VALUES (?, ?, ?)", [id, `Ranking ${id}`, `ranking-${id}`]);
        await dataSource.query(
            "INSERT INTO game_genres_game_genre (gameId, gameGenreId) VALUES (?, ?), (?, ?), (?, ?), (?, ?)",
            [ids[4], genreId, ids[4], genreId + 1, ids[0], genreId, ids[2], genreId + 1],
        );
        const filtered = await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: "popular" as any,
            period: "month",
            criteria: { ids, genres: [genreId, genreId + 1] } as any,
            limit: 2,
            offset: 1,
        });
        expect(filtered.pagination.total).toBe(3);
        expect(filtered.items.map((item: any) => item.sourceId)).toEqual([ids[0], ids[2]]);
    });

    it("serves missing presets from projected metrics without rebuilding a key during the request", async () => {
        const gameId = 2_060_000_000 - randomInt(100_000);
        const targetId = await createGame(gameId);
        await setMetric(targetId, "views", 13);
        await setMetric(targetId, "like_credit", 2);
        await dataSource.query(
            "INSERT INTO metric_hour (targetId, metricCode, bucketStart, metricValue) VALUES (?, 'views', DATE_FORMAT(UTC_TIMESTAMP() - INTERVAL 2 HOUR, '%Y-%m-%d %H:00:00'), 3)",
            [targetId],
        );
        for (const [period, expectedScore] of [["all", 23], ["day", 3]] as const) {
            const key = `game:popular:${period}`;
            await dataSource.query("DELETE FROM ranking_score WHERE rankingKey = ?", [key]);
            const page = await service.findRankings(undefined, {
                sourceType: StatisticsSourceType.GAME,
                mode: "popular" as any,
                period,
                criteria: { ids: [gameId] } as any,
                limit: 20,
                offset: 0,
            });
            expect(page.items).toEqual([expect.objectContaining({ sourceId: gameId, score: expectedScore, viewsCount: 13 })]);
            const [count] = await dataSource.query("SELECT COUNT(*) AS total FROM ranking_score WHERE rankingKey = ?", [key]);
            expect(Number(count.total)).toBe(0);
        }
    });

    it("pins only eligible reviews and rejects unbounded recent/all rankings", async () => {
        const gameId = 2_000_000_000 - randomInt(100_000);
        await createGame(gameId);
        const publicOwner = randomUUID();
        const privateOwner = randomUUID();
        const publicReview = await createReview(gameId, publicOwner, true, 3);
        const privateReview = await createReview(gameId, privateOwner, false, 50);
        const page = await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.REVIEW,
            mode: "popular" as any,
            period: "all",
            gameId,
            reviewId: privateReview,
            limit: 10,
            offset: 0,
        });
        expect(page.items.map((item: any) => item.sourceId)).toContain(publicReview);
        expect(page.items.map((item: any) => item.sourceId)).not.toContain(privateReview);
        await expect(service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: "recent" as any,
            period: "all",
            limit: 20,
            offset: 0,
        })).rejects.toThrow(BadRequestException);
    });

    it("retains microseconds in explicit ranking intervals", async () => {
        const gameId = 2_100_000_000 - randomInt(100_000);
        const targetId = await createGame(gameId);
        const namespace = randomUUID();
        for (const [index, occurredAt] of [
            "2025-04-12 10:20:00.000122",
            "2025-04-12 10:20:00.000123",
            "2025-04-12 10:20:00.000124",
            "2025-04-12 10:20:00.000125",
        ].entries()) {
            await dataSource.query(
                `INSERT INTO statistics_event (eventKey, eventVersion, eventKind, targetId, occurredAt, projectionState, nextAttemptAt)
                VALUES (?, 1, 'view.recorded', ?, ?, 'done', CURRENT_TIMESTAMP(6))`,
                [`ranking-micro:${namespace}:${index}`, targetId, occurredAt],
            );
        }
        const page = await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: "popular" as any,
            from: "2025-04-12T10:20:00.000123Z",
            to: "2025-04-12T10:20:00.000125Z",
            criteria: { ids: [gameId] } as any,
            limit: 10,
            offset: 0,
        });
        expect(page.items).toEqual([
            expect.objectContaining({ sourceId: gameId, score: 2 }),
        ]);
        expect(page.effectiveFrom).toBe("2025-04-12T10:20:00.000123Z");
        expect(page.effectiveTo).toBe("2025-04-12T10:20:00.000125Z");
        await expect(service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: "popular" as any,
            period: "all",
            criteria: { ids: [-1] } as any,
            limit: 20,
            offset: 0,
        })).rejects.toThrow(BadRequestException);
    });

    it("uses first-like weights and halves recent scores after 24 hours", async () => {
        const gameId = 2_100_000_000 - randomInt(100_000);
        const targetId = await createGame(gameId);
        await dataSource.query(
            "INSERT INTO metric_hour (targetId, metricCode, bucketStart, metricValue) VALUES (?, 'views', '2025-04-10 10:00:00', 1), (?, 'like_credit', '2025-04-10 10:00:00', 1)",
            [targetId, targetId],
        );
        const request = { sourceType: StatisticsSourceType.GAME, mode: "recent", from: "2025-04-10T10:00:00Z", criteria: { ids: [gameId] } } as any;
        const first = await service.findRankings(undefined, { ...request, to: "2025-04-11T10:00:00Z" });
        const later = await service.findRankings(undefined, { ...request, to: "2025-04-12T10:00:00Z" });
        expect(first.items[0].score).toBeCloseTo(3);
        expect(later.items[0].score).toBeCloseTo(1.5);
        const popular = await service.findRankings(undefined, { ...request, mode: "popular", to: "2025-04-12T10:00:00Z" });
        expect(popular.items[0].score).toBe(6);
        await expect(service.findRankings(undefined, { ...request, period: "day", to: "2025-04-12T10:00:00Z" })).rejects.toThrow(BadRequestException);
    });

    it.each([StatisticsSourceType.GAME, StatisticsSourceType.REVIEW])("shares public %s pages across actors for fifteen minutes", async (sourceType) => {
        const gameId = 2_120_000_000 - randomInt(100_000);
        let targetId = await createGame(gameId);
        const owner = randomUUID();
        let sourceId: string | number = gameId;
        if (sourceType === StatisticsSourceType.REVIEW) {
            sourceId = await createReview(gameId, owner, true, 8);
            const [review] = await dataSource.query("SELECT statisticsTargetId FROM review WHERE id = ?", [sourceId]);
            targetId = Number(review.statisticsTargetId);
        }
        await setMetric(targetId, "views", 8);
        const cache = createCache();
        const written = jest.spyOn(cache, "set");
        const rankings = new StatisticsRankingService(dataSource, cache);
        const request = { sourceType, mode: "popular", period: "all", limit: 20, offset: 0,
            ...(sourceType === StatisticsSourceType.GAME ? { criteria: { ids: [gameId] } } : { gameId }) } as any;
        const before = Date.now();
        await rankings.findRankings(owner, request);
        await setMetric(targetId, "views", 99);
        for (const actor of [randomUUID(), undefined]) {
            const page = await rankings.findRankings(actor, request);
            expect(page.items).toEqual([expect.objectContaining({ sourceId, viewsCount: 8 })]);
        }
        expect(written).toHaveBeenCalledTimes(1);
        const cached = await cache.stores[0].get(written.mock.calls[0][0], { raw: true });
        expect(cached?.expires).toBeGreaterThanOrEqual(before + 15 * 60_000);
        expect(cached?.expires).toBeLessThanOrEqual(Date.now() + 15 * 60_000);
        await cache.disconnect();
    });

    it("refreshes a cached page immediately when new prepared scores are published", async () => {
        const firstId = 2_130_000_000 - randomInt(100_000);
        const firstTarget = await createGame(firstId);
        const secondTarget = await createGame(firstId + 1);
        const key = "game:popular:month";
        await dataSource.query(
            `INSERT INTO ranking_score (rankingKey, targetId, score, definitionVersion, computedAt)
             VALUES (?, ?, 1, 'engagement-v1', '2025-04-12 10:00:00'), (?, ?, 2, 'engagement-v1', '2025-04-12 10:00:00')`,
            [key, firstTarget, key, secondTarget],
        );
        await dataSource.query("UPDATE ranking_score SET computedAt = '2025-04-12 10:00:00' WHERE rankingKey = ?", [key]);
        const cache = createCache();
        const rankings = new StatisticsRankingService(dataSource, cache);
        const request = { sourceType: StatisticsSourceType.GAME, mode: "popular", period: "month",
            criteria: { ids: [firstId, firstId + 1] }, limit: 1, offset: 0 } as any;
        const first = await rankings.findRankings(undefined, request);
        expect(first.items[0].sourceId).toBe(firstId + 1);
        await dataSource.query(
            "UPDATE ranking_score SET computedAt = '2025-04-12 11:00:00', score = IF(targetId = ?, 10, score) WHERE rankingKey = ?",
            [firstTarget, key],
        );
        const refreshed = await rankings.findRankings(undefined, request);
        expect(refreshed.items[0].sourceId).toBe(firstId);
        expect(refreshed.asOf).not.toBe(first.asOf);
        await cache.disconnect();
    });

    it("rechecks cached review visibility even when the eligible total is unchanged", async () => {
        const gameId = 2_140_000_000 - randomInt(100_000);
        await createGame(gameId);
        const firstReview = await createReview(gameId, randomUUID(), true, 4);
        const secondReview = await createReview(gameId, randomUUID(), false, 5);
        const cache = createCache();
        const rankings = new StatisticsRankingService(dataSource, cache);
        const request = { sourceType: StatisticsSourceType.REVIEW, mode: "popular", period: "all", gameId } as any;
        const first = await rankings.findRankings(randomUUID(), request);
        expect(first.items.map((item: any) => item.sourceId)).toEqual([firstReview]);
        await dataSource.query(
            `UPDATE collection c JOIN collection_entry_collections_collection m ON m.collectionId = c.id
             JOIN review r ON r.collectionEntryId = m.collectionEntryId
             SET c.isPublic = IF(r.id = ?, 0, 1) WHERE r.id IN (?, ?)`,
            [firstReview, firstReview, secondReview],
        );
        const changed = await rankings.findRankings(undefined, request);
        expect(changed.pagination.total).toBe(first.pagination.total);
        expect(changed.items.map((item: any) => item.sourceId)).toEqual([secondReview]);
        await cache.disconnect();
    });

    it("keeps actor-specific cached filters separate and serves scores when cache is down", async () => {
        const gameId = 2_100_000_000 - randomInt(100_000);
        await createGame(gameId);
        const firstOwner = randomUUID();
        const secondOwner = randomUUID();
        const firstReview = await createReview(gameId, firstOwner, true, 4);
        const secondReview = await createReview(gameId, secondOwner, true, 1);
        const values = new Map<string, unknown>();
        const rankings = new StatisticsRankingService(dataSource, {
            get: async (key: string) => values.get(key),
            set: async (key: string, value: unknown) => { values.set(key, value); },
        } as any);
        const request = { sourceType: StatisticsSourceType.REVIEW, mode: "popular", period: "all", gameId, excludeOwn: true } as any;
        const first = await rankings.findRankings(firstOwner, request);
        const second = await rankings.findRankings(secondOwner, request);
        expect(first.items.map((item: any) => item.sourceId)).toEqual([secondReview]);
        expect(second.items.map((item: any) => item.sourceId)).toEqual([firstReview]);
        expect(values.size).toBe(2);
        expect((await rankings.findRankings(firstOwner, { ...request, authorId: firstOwner, reviewId: firstReview })).items).toEqual([]);
        const unavailableCache = new StatisticsRankingService(dataSource, {
            get: async () => { throw new Error("cache down"); },
            set: async () => { throw new Error("cache down"); },
        } as any);
        expect((await unavailableCache.findRankings(firstOwner, request)).items).toEqual(first.items);
    });
});
