jest.mock("./client/callXboxApi", () => ({ callXboxAPI: jest.fn() }));
import { XboxSyncService } from "./xbox-sync.service";
import { callXboxAPI } from "./client/callXboxApi";
import { setCacheManager } from "../../utils/cacheable";

const request = jest.mocked(callXboxAPI);
const service = new XboxSyncService(
    { getAuthCredentials: jest.fn().mockResolvedValue({}) } as any,
    {} as any,
);

beforeEach(() => {
    jest.clearAllMocks();
    setCacheManager({
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
    } as any);
});

describe("Xbox statistics batches", () => {
    it.each([
        [0, []],
        [1, [1]],
        [999, [999]],
        [1000, [1000]],
        [1001, [1000, 1]],
        [2001, [1000, 1000, 1]],
    ] as [number, number[]][])(
        "requests %i titles without overlap",
        async (count, sizes) => {
            const titles = Array.from({ length: count }, (_, i) => String(i));
            request.mockImplementation(
                async (config) =>
                    ({
                        statlistscollection: [
                            {
                                stats: config!.data.stats.map((stat: any) => ({
                                    titleid: stat.titleId,
                                    value: "1",
                                })),
                            },
                        ],
                    }) as any,
            );
            const result = await service.getBatchMinutesPlayed(
                "source-user",
                titles,
            );
            const batches = request.mock.calls.map(
                ([config]) => config!.data.stats,
            );
            expect(batches.map((batch) => batch.length)).toEqual(sizes);
            expect(batches.flat().map((stat) => stat.titleId)).toEqual(titles);
            expect(result.map((stat) => stat.titleid)).toEqual(titles);
        },
    );
});

describe("Xbox empty and incomplete statistics", () => {
    it.each([
        { statlistscollection: [] },
        { statlistscollection: [{ stats: [] }] },
    ])("advances after a valid empty batch", async (empty) => {
        request.mockResolvedValueOnce(empty as any).mockResolvedValueOnce({
            statlistscollection: [{ stats: [{ titleid: "1000", value: "1" }] }],
        } as any);
        const result = await service.getBatchMinutesPlayed(
            "source-user",
            Array.from({ length: 1001 }, (_, i) => String(i)),
        );
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls[1][0]!.data.stats).toEqual([
            { name: "MinutesPlayed", titleId: "1000" },
        ]);
        expect(result).toEqual([{ titleid: "1000", value: "1" }]);
    });

    it.each([
        undefined,
        {},
        { statlistscollection: null },
        { statlistscollection: [{}] },
    ])(
        "rejects malformed responses instead of caching partial data",
        async (response) => {
            request.mockResolvedValue(response as any);
            await expect(
                service.getBatchMinutesPlayed("source-user", ["1"]),
            ).rejects.toThrow("Incomplete Xbox statistics response");
            expect(request).toHaveBeenCalledTimes(1);
        },
    );

    it("preserves a later request failure instead of returning earlier statistics", async () => {
        const failure = new Error("fixture request failure");
        request
            .mockResolvedValueOnce({
                statlistscollection: [{ stats: [{ titleid: "0" }] }],
            } as any)
            .mockRejectedValueOnce(failure);
        await expect(
            service.getBatchMinutesPlayed(
                "source-user",
                Array.from({ length: 1001 }, (_, i) => String(i)),
            ),
        ).rejects.toBe(failure);
        expect(request).toHaveBeenCalledTimes(2);
    });
});

describe("Xbox complete achievement pages", () => {
    const item = (id: string) => ({ id, serviceConfigId: "set" });
    const page = (
        ids: string[],
        continuationToken: string | null,
        totalRecords = 2,
    ) => ({
        achievements: ids.map(item),
        pagingInfo: { continuationToken, totalRecords },
    });

    it("follows the returned token even for short pages", async () => {
        request
            .mockResolvedValueOnce(page(["1"], "next") as any)
            .mockResolvedValueOnce(page(["2"], null) as any);
        await expect(
            service.getObtainedAchievements("user", "title"),
        ).resolves.toEqual([item("1"), item("2")]);
        expect(request.mock.calls.map(([config]) => config!.params)).toEqual([
            { titleId: "title", maxItems: 1000 },
            { titleId: "title", maxItems: 1000, continuationToken: "next" },
        ]);
    });

    it("accepts a confirmed empty result", async () => {
        request.mockResolvedValue(page([], null, 0) as any);
        await expect(
            service.getObtainedAchievements("user", "title"),
        ).resolves.toEqual([]);
    });

    it.each([
        page(["2"], "next", 3),
        page(["1"], null),
        page([], "new"),
        page(["2"], null, 3),
        {},
    ])(
        "rejects incomplete or cyclic pages without caching partial success",
        async (second) => {
            const set = jest.fn().mockResolvedValue(undefined);
            setCacheManager({
                get: jest.fn().mockResolvedValue(undefined),
                set,
            } as any);
            request
                .mockResolvedValueOnce(page(["1"], "next") as any)
                .mockResolvedValueOnce(second as any);
            await expect(
                service.getObtainedAchievements("user", "title"),
            ).rejects.toThrow();
            expect(request).toHaveBeenCalledTimes(2);
            expect(set).not.toHaveBeenCalled();
        },
    );

    it("propagates a later request failure", async () => {
        request
            .mockResolvedValueOnce(page(["1"], "next") as any)
            .mockRejectedValueOnce(new Error("page failed"));
        await expect(
            service.getObtainedAchievements("user", "title"),
        ).rejects.toThrow("page failed");
    });
});

describe("Xbox TitleHub completeness", () => {
    it.each([0, 1, 4999])(
        "accepts a below-cap library of %i titles",
        async (count) => {
            const titles = Array.from({ length: count }, (_, i) => ({
                titleId: String(i),
            }));
            request.mockResolvedValue({ titles } as any);
            await expect(service.getAllGames("user")).resolves.toEqual(titles);
            expect(request.mock.calls[0][0]!.params).toEqual({
                maxItems: 5000,
            });
            expect(request).toHaveBeenCalledTimes(1);
        },
    );

    it.each([
        { titles: Array(5000).fill({}) },
        { titles: Array(5001).fill({}) },
        { titles: [], pagingInfo: { continuationToken: "next" } },
        { titles: [], pagingInfo: { totalRecords: 1 } },
        { titles: [], continuationToken: "next" },
        { titles: [], totalItemCount: 1 },
        { titles: [], hasMore: true },
        { titles: [], nextLink: "next" },
        {},
    ])(
        "rejects capped, truncated, or malformed libraries without caching",
        async (response) => {
            const set = jest.fn().mockResolvedValue(undefined);
            setCacheManager({
                get: jest.fn().mockResolvedValue(undefined),
                set,
            } as any);
            request.mockResolvedValue(response as any);
            await expect(service.getAllGames("user")).rejects.toThrow(
                "Incomplete Xbox TitleHub",
            );
            expect(request).toHaveBeenCalledTimes(1);
            expect(set).not.toHaveBeenCalled();
        },
    );
});

it("uses token exhaustion when Xbox cannot supply a total", async () => {
    request
        .mockResolvedValueOnce({
            achievements: [{ id: "1", serviceConfigId: "set" }],
            pagingInfo: { continuationToken: "next" },
        } as any)
        .mockResolvedValueOnce({
            achievements: [{ id: "2", serviceConfigId: "set" }],
            pagingInfo: { continuationToken: null },
        } as any);
    await expect(
        service.getObtainedAchievements("user", "title"),
    ).resolves.toHaveLength(2);
});

it("checks the documented Xbox totalItems field", async () => {
    request.mockResolvedValue({
        achievements: [],
        pagingInfo: { continuationToken: null, totalItems: 1 },
    } as any);
    await expect(
        service.getObtainedAchievements("user", "title"),
    ).rejects.toThrow("Incomplete Xbox achievement total");
});

it("rejects missing Xbox continuation metadata", async () => {
    request.mockResolvedValue({ achievements: [], pagingInfo: {} } as any);
    await expect(
        service.getObtainedAchievements("user", "title"),
    ).rejects.toThrow("Incomplete Xbox achievement response");
});

it("bounds Xbox pages even when every token and identity is new", async () => {
    let page = 0;
    request.mockImplementation(async () => {
        const id = String(++page);
        return {
            achievements: [{ id, serviceConfigId: "set" }],
            pagingInfo: { continuationToken: id },
        } as any;
    });
    await expect(
        service.getObtainedAchievements("user", "title"),
    ).rejects.toThrow("page limit exceeded");
    expect(request).toHaveBeenCalledTimes(1000);
});
