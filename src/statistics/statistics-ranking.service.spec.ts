import "reflect-metadata";
import { StatisticsRankingMode } from "./dto/statistics-api.dto";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { StatisticsSourceType } from "./statistics.constants";

function createHarness() {
    const state = {
        computedAt: new Date("2025-04-12T10:00:00Z") as Date | null,
        total: 2,
        gameRows: [
            { sourceId: 1, targetId: 11, score: 9 },
            { sourceId: 2, targetId: 12, score: 8 },
        ] as any[],
        reviewRows: [{ sourceId: "review-1", score: 5, viewsCount: 2, likesCount: 1 }] as any[],
    };
    const queries: Array<{ sql: string; parameters: any[] }> = [];
    const manager = {
        query: jest.fn(async (sql: string, parameters: any[] = []) => {
            const normalized = sql.replace(/\s+/g, " ");
            queries.push({ sql: normalized, parameters });
            if (normalized.includes("SELECT computedAt FROM ranking_score"))
                return state.computedAt ? [{ computedAt: state.computedAt }] : [];
            if (normalized.includes("COUNT(*) AS total")) return [{ total: state.total }];
            if (normalized.includes("COUNT(*) AS count")) return [{ count: state.gameRows.length }];
            if (normalized.includes("SELECT g.id AS sourceId")) {
                const limit = Number(parameters[parameters.length - 2]);
                const offset = Number(parameters[parameters.length - 1]);
                return state.gameRows.slice(offset, offset + limit);
            }
            if (normalized.includes("SELECT r.id AS sourceId")) {
                const limit = Number(parameters[parameters.length - 2]);
                const offset = Number(parameters[parameters.length - 1]);
                return state.reviewRows.slice(offset, offset + limit);
            }
            if (normalized.includes("FROM statistics_target t"))
                return state.gameRows.map((row) => ({ targetId: row.targetId, viewsCount: 1, likesCount: 0 }));
            if (normalized.includes("SUM(projectionState = 'failed')"))
                return [{ failedCount: 0, oldestPendingAt: null }];
            throw new Error(`Unexpected query: ${normalized}`);
        }),
    };
    const dataSource = { transaction: async (callback: any) => callback(manager) } as any;
    return { state, queries, manager, dataSource };
}

function createMemoryCache() {
    const values = new Map<string, any>();
    return {
        values,
        get: jest.fn(async (key: string) => values.get(key) ?? null),
        set: jest.fn(async (key: string, value: any, _ttl?: number) => {
            values.set(key, value);
        }),
    };
}

describe("StatisticsRankingService", () => {
    it("drives prepared game rankings from positive ranking_score rows", async () => {
        const harness = createHarness();
        const service = new StatisticsRankingService(harness.dataSource, createMemoryCache() as any);

        await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: StatisticsRankingMode.POPULAR,
            period: "month",
            criteria: { ids: [1, 2] } as any,
            limit: 20,
            offset: 0,
        });

        const count = harness.queries.find((entry) => entry.sql.includes("COUNT(*) AS total"));
        expect(count?.sql).toContain(
            "FROM ranking_score prepared STRAIGHT_JOIN game g ON g.statisticsTargetId = prepared.targetId STRAIGHT_JOIN statistics_target t ON t.id = prepared.targetId",
        );
        expect(count?.sql).toContain("prepared.rankingKey = ? AND prepared.score > 0");
        expect(count?.sql).not.toContain("USE INDEX");
        expect(count?.sql).not.toContain("(SELECT targetId, score FROM ranking_score");
        expect(count?.parameters[0]).toBe("game:popular:month");

        const page = harness.queries.find((entry) => entry.sql.includes("SELECT g.id AS sourceId"));
        expect(page?.sql).toContain("FROM ranking_score prepared STRAIGHT_JOIN game g");
        expect(page?.sql).not.toContain("(SELECT targetId, score FROM ranking_score");
    });

    it("keeps the computed score subquery for explicit game intervals", async () => {
        const harness = createHarness();
        const service = new StatisticsRankingService(harness.dataSource, createMemoryCache() as any);

        await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: StatisticsRankingMode.POPULAR,
            from: "2025-04-12T10:00:00Z",
            to: "2025-04-12T11:00:00Z",
            criteria: { ids: [1, 2] } as any,
            limit: 20,
            offset: 0,
        });

        const count = harness.queries.find((entry) => entry.sql.includes("COUNT(*) AS total"));
        expect(count?.sql).toContain("FROM game g USE INDEX");
        expect(count?.sql).toContain("JOIN (SELECT targetId");
        expect(count?.sql).not.toContain("FROM ranking_score prepared STRAIGHT_JOIN");
    });

    it("left joins prepared review scores directly from ranking_score", async () => {
        const harness = createHarness();
        const service = new StatisticsRankingService(harness.dataSource, createMemoryCache() as any);

        await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.REVIEW,
            mode: StatisticsRankingMode.POPULAR,
            period: "month",
            gameId: 1,
            limit: 20,
            offset: 0,
        });

        const page = harness.queries.find((entry) => entry.sql.includes("SELECT r.id AS sourceId"));
        expect(page?.sql).toContain(
            "LEFT JOIN ranking_score prepared ON prepared.rankingKey = ? AND prepared.targetId = t.id",
        );
        expect(page?.sql).not.toContain("(SELECT targetId, score FROM ranking_score");
        expect(page?.parameters[0]).toBe("review:popular:month");
    });

    it("reuses the filtered total across deep pages under the same asOf", async () => {
        const harness = createHarness();
        const cache = createMemoryCache();
        const service = new StatisticsRankingService(harness.dataSource, cache as any);
        const request = {
            sourceType: StatisticsSourceType.GAME,
            mode: StatisticsRankingMode.POPULAR,
            period: "month",
            criteria: { ids: [1, 2] },
        } as any;

        const first = await service.findRankings(undefined, { ...request, limit: 2, offset: 0 });
        const deep = await service.findRankings(undefined, { ...request, limit: 2, offset: 60 });

        expect(first.pagination.total).toBe(2);
        expect(deep.pagination.total).toBe(2);
        expect(deep.items).toEqual([]);
        expect(harness.queries.filter((entry) => entry.sql.includes("COUNT(*) AS total"))).toHaveLength(1);

        const totalWrites = cache.set.mock.calls.filter(([key]) => String(key).includes(":total:"));
        expect(totalWrites).toHaveLength(1);
        expect(totalWrites[0][2]).toBe(6 * 60 * 60_000);
        expect(String(totalWrites[0][0])).toMatch(
            /^statistics:rank:v3:engagement-v1:total:[a-f0-9]{64}:2025-04-12T10:00:00\.000000Z$/,
        );
    });

    it("uses a new total key after prepared scores publish a new asOf", async () => {
        const harness = createHarness();
        const cache = createMemoryCache();
        const service = new StatisticsRankingService(harness.dataSource, cache as any);
        const request = {
            sourceType: StatisticsSourceType.GAME,
            mode: StatisticsRankingMode.POPULAR,
            period: "month",
            criteria: { ids: [1, 2] },
            limit: 2,
            offset: 0,
        } as any;

        await service.findRankings(undefined, request);
        harness.state.computedAt = new Date("2025-04-12T16:00:00Z");
        await service.findRankings(undefined, request);

        expect(harness.queries.filter((entry) => entry.sql.includes("COUNT(*) AS total"))).toHaveLength(2);
        const totalKeys = cache.set.mock.calls
            .map(([key]) => String(key))
            .filter((key) => key.includes(":total:"));
        expect(totalKeys).toHaveLength(2);
        expect(totalKeys[0]).not.toBe(totalKeys[1]);
        expect(totalKeys[1]).toContain("2025-04-12T16:00:00.000000Z");
    });

    it("falls back to counting when the total cache is unavailable", async () => {
        const harness = createHarness();
        const service = new StatisticsRankingService(harness.dataSource, {
            get: async () => {
                throw new Error("cache down");
            },
            set: async () => {
                throw new Error("cache down");
            },
        } as any);

        const page = await service.findRankings(undefined, {
            sourceType: StatisticsSourceType.GAME,
            mode: StatisticsRankingMode.POPULAR,
            period: "month",
            criteria: { ids: [1, 2] } as any,
            limit: 20,
            offset: 0,
        });

        expect(page.pagination.total).toBe(2);
        expect(harness.queries.filter((entry) => entry.sql.includes("COUNT(*) AS total"))).toHaveLength(1);
    });

    it("warms the default first page of common prepared game rankings", async () => {
        const harness = createHarness();
        const cache = createMemoryCache();
        const service = new StatisticsRankingService(harness.dataSource, cache as any);
        jest.spyOn(service as any, "refreshKey").mockResolvedValue(undefined);

        await service.refreshCommonScores();

        const warmedPages = cache.set.mock.calls
            .filter(([key]) => String(key).includes(":response:"))
            .map(([, value]) => value as any);
        expect(warmedPages).toHaveLength(4);
        for (const page of warmedPages) expect(page.pagination).toMatchObject({ offset: 0, limit: 20, total: 2 });

        const counts = harness.queries.filter((entry) => entry.sql.includes("COUNT(*) AS total"));
        expect(counts.map((entry) => entry.parameters[0]).sort()).toEqual([
            "game:popular:all",
            "game:popular:month",
            "game:popular:week",
            "game:recent:week",
        ]);
    });

    it("keeps the refresh successful when page warming fails", async () => {
        const service = new StatisticsRankingService({} as any, createMemoryCache() as any);
        jest.spyOn(service as any, "refreshKey").mockResolvedValue(undefined);
        jest.spyOn(service, "findRankings").mockRejectedValue(new Error("cache down"));

        await expect(service.refreshCommonScores()).resolves.toBeUndefined();
        expect(service.findRankings).toHaveBeenCalledTimes(4);
    });
});
