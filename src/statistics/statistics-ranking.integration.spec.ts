import "reflect-metadata";
import { randomInt, randomUUID } from "node:crypto";
import { BadRequestException } from "@nestjs/common";
import { DataSource } from "typeorm";
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
                `INSERT INTO statistics_event (eventKey, eventVersion, eventKind, targetId, occurredAt, provenance, projectionState, nextAttemptAt)
                VALUES (?, 1, 'view.recorded', ?, ?, 'live', 'done', CURRENT_TIMESTAMP(6))`,
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
        expect((await rankings.findRankings(firstOwner, { ...request, authorId: firstOwner, reviewId: firstReview })).items).toEqual([]);
        const unavailableCache = new StatisticsRankingService(dataSource, {
            get: async () => { throw new Error("cache down"); },
            set: async () => { throw new Error("cache down"); },
        } as any);
        expect((await unavailableCache.findRankings(firstOwner, request)).items).toEqual(first.items);
    });
});
