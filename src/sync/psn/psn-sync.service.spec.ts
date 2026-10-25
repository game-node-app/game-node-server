import { setPlayerProviderBudget } from "../player-provider-budget.service";
import {
    runPlayerSyncAttempt,
    PLAYER_ATTEMPT_TIMEOUT_MS,
} from "../player-sync-attempt";
jest.mock("psn-api", () => ({
    getUserTitles: jest.fn(),
    getUserPlayedGames: jest.fn(),
    getTitleTrophies: jest.fn(),
    getUserTrophiesEarnedForTitle: jest.fn(),
    getTitleTrophyGroups: jest.fn(),
}));
import {
    getUserTitles,
    getUserPlayedGames,
    getTitleTrophyGroups,
    getTitleTrophies,
    getUserTrophiesEarnedForTitle,
} from "psn-api";
import { PsnSyncService } from "./psn-sync.service";
import { setCacheManager } from "../../utils/cacheable";

const titlesRequest = jest.mocked(getUserTitles);
const gamesRequest = jest.mocked(getUserPlayedGames);
const service = new PsnSyncService({
    getValidAccessToken: jest.fn().mockResolvedValue({}),
} as any);

beforeEach(() => {
    jest.clearAllMocks();
    setCacheManager({
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
    } as any);
});

describe("PSN trophy-title pages", () => {
    it.each([0, 1, 799, 800, 801, 1600])(
        "fetches %i titles once in order using an explicit limit",
        async (total) => {
            const titles = Array.from({ length: total }, (_, i) => ({
                npCommunicationId: String(i),
                npServiceName: "trophy2",
            }));
            titlesRequest.mockImplementation(
                async (_auth, _account, options) =>
                    ({
                        trophyTitles: titles.slice(
                            options!.offset!,
                            options!.offset! + options!.limit!,
                        ),
                        totalItemCount: total,
                    }) as any,
            );
            expect(await service.getUserTrophyTitles("source-user")).toEqual(
                titles,
            );
            expect(
                titlesRequest.mock.calls.map(([, , options]) => options),
            ).toEqual(
                Array.from(
                    { length: Math.max(1, Math.ceil(total / 800)) },
                    (_, i) => ({ offset: i * 800, limit: 800 }),
                ),
            );
        },
    );

    it("advances by the actual returned count when the provider caps a page", async () => {
        titlesRequest
            .mockResolvedValueOnce({
                trophyTitles: [
                    { npCommunicationId: "1", npServiceName: "trophy2" },
                ],
                totalItemCount: 2,
            } as any)
            .mockResolvedValueOnce({
                trophyTitles: [
                    { npCommunicationId: "2", npServiceName: "trophy2" },
                ],
                totalItemCount: 2,
            } as any);
        expect(await service.getUserTrophyTitles("source-user")).toHaveLength(
            2,
        );
        expect(titlesRequest.mock.calls[1][2]).toEqual({
            offset: 1,
            limit: 800,
        });
    });
});

describe.each(["played", "trophy"] as const)(
    "PSN %s pagination guards",
    (kind) => {
        const fetch = () =>
            kind === "played"
                ? service.getAllGames("source-user")
                : service.getUserTrophyTitles("source-user");
        const request = kind === "played" ? gamesRequest : titlesRequest;
        const key = kind === "played" ? "titles" : "trophyTitles";
        const item = {
            titleId: "1",
            npCommunicationId: "1",
            npServiceName: "trophy2",
        };

        it.each([undefined, null, -1, NaN, Infinity, 1.5, "2"])(
            "rejects invalid totals %s",
            async (totalItemCount) => {
                request.mockResolvedValue({ [key]: [], totalItemCount } as any);
                await expect(fetch()).rejects.toThrow("Incomplete PSN");
                expect(request).toHaveBeenCalledTimes(1);
            },
        );

        it("accepts a confirmed empty library", async () => {
            request.mockResolvedValue({ [key]: [], totalItemCount: 0 } as any);
            await expect(fetch()).resolves.toEqual([]);
            expect(request).toHaveBeenCalledTimes(1);
        });

        it("rejects an empty page while items remain", async () => {
            request.mockResolvedValue({ [key]: [], totalItemCount: 2 } as any);
            await expect(fetch()).rejects.toThrow("no progress");
            expect(request).toHaveBeenCalledTimes(1);
        });

        it("rejects a repeated page even if its offset advanced", async () => {
            request.mockResolvedValue({
                [key]: [item],
                totalItemCount: 2,
            } as any);
            await expect(fetch()).rejects.toThrow("Repeated");
            expect(request).toHaveBeenCalledTimes(2);
        });

        it("rejects changing totals instead of claiming completeness", async () => {
            request
                .mockResolvedValueOnce({
                    [key]: [item],
                    totalItemCount: 2,
                } as any)
                .mockResolvedValueOnce({ [key]: [], totalItemCount: 1 } as any);
            await expect(fetch()).rejects.toThrow("Incomplete PSN");
            expect(request).toHaveBeenCalledTimes(2);
        });

        it.each([0, 2, -1])(
            "rejects repeated or skipping continuation %s",
            async (nextOffset) => {
                request.mockResolvedValue({
                    [key]: [item],
                    totalItemCount: 3,
                    nextOffset,
                } as any);
                await expect(fetch()).rejects.toThrow("continuation");
                expect(request).toHaveBeenCalledTimes(1);
            },
        );

        it("propagates page-two failure instead of returning earlier items", async () => {
            request
                .mockResolvedValueOnce({
                    [key]: [item],
                    totalItemCount: 2,
                } as any)
                .mockRejectedValueOnce(new Error("fixture failure"));
            await expect(fetch()).rejects.toThrow();
            expect(request).toHaveBeenCalledTimes(2);
        });
    },
);

describe.each(["available", "obtained"] as const)(
    "PSN %s trophy details",
    (kind) => {
        const request = jest.mocked(
            kind === "available"
                ? getTitleTrophies
                : getUserTrophiesEarnedForTitle,
        );
        const fetch = () =>
            kind === "available"
                ? service.getGameAchievements("set", "trophy2")
                : service.getObtainedAchievements("user", "set", "trophy2");
        const page = (
            ids: number[],
            totalItemCount = 2,
            nextOffset?: number,
        ) => ({
            trophies: ids.map((trophyId) => ({ trophyId })),
            totalItemCount,
            nextOffset,
        });

        it("fetches all pages with explicit offsets and limits", async () => {
            request
                .mockResolvedValueOnce(page([0], 2, 1) as any)
                .mockResolvedValueOnce(page([1]) as any);
            await expect(fetch()).resolves.toEqual([
                { trophyId: 0 },
                { trophyId: 1 },
            ]);
            expect(
                request.mock.calls.map((args) => args[args.length - 1]),
            ).toEqual([
                { npServiceName: "trophy2", offset: 0, limit: 100 },
                { npServiceName: "trophy2", offset: 1, limit: 100 },
            ]);
        });

        it("accepts a successful empty set", async () => {
            request.mockResolvedValue(page([], 0) as any);
            await expect(fetch()).resolves.toEqual([]);
        });

        it.each([
            page([0]),
            page([], 2),
            page([1], 3),
            page([1], 2, 0),
            {},
            { error: "private" },
        ])(
            "rejects incomplete/repeated pages without caching partial data",
            async (second) => {
                const set = jest.fn().mockResolvedValue(undefined);
                setCacheManager({
                    get: jest.fn().mockResolvedValue(undefined),
                    set,
                } as any);
                request
                    .mockResolvedValueOnce(page([0]) as any)
                    .mockResolvedValueOnce(second as any);
                await expect(fetch()).rejects.toThrow();
                expect(request).toHaveBeenCalledTimes(2);
                expect(set).not.toHaveBeenCalled();
            },
        );

        it("propagates a page-two failure", async () => {
            request
                .mockResolvedValueOnce(page([0]) as any)
                .mockRejectedValueOnce(new Error("page failed"));
            await expect(fetch()).rejects.toMatchObject({ outcome: "failed" });
        });
    },
);

it("keeps opaque PSN errors incomplete and never treats their text as an empty success", async () => {
    gamesRequest.mockResolvedValue({
        error: { code: 429, message: "private token=secret" },
    } as any);
    await expect(service.getAllGames("user")).rejects.toMatchObject({
        outcome: "incomplete",
    });
});

it("rejects malformed PSN trophy groups before caching", async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    setCacheManager({
        get: jest.fn().mockResolvedValue(undefined),
        set,
    } as any);
    jest.mocked(getTitleTrophyGroups).mockResolvedValue({
        error: { message: "private token=secret" },
    } as any);
    await expect(
        service.getGameAchievementGroups("set", "trophy2"),
    ).rejects.toMatchObject({ outcome: "incomplete" });
    expect(set).not.toHaveBeenCalled();
});

describe.each(["played", "trophy"] as const)(
    "PSN %s page-two failure",
    (kind) => {
        it("never caches a partial combined library", async () => {
            const set = jest.fn().mockResolvedValue(undefined);
            setCacheManager({
                get: jest.fn().mockResolvedValue(undefined),
                set,
            } as any);
            const request = kind === "played" ? gamesRequest : titlesRequest;
            const key = kind === "played" ? "titles" : "trophyTitles";
            request
                .mockResolvedValueOnce({
                    [key]: [
                        {
                            titleId: "1",
                            npCommunicationId: "1",
                            npServiceName: "trophy2",
                        },
                    ],
                    totalItemCount: 2,
                } as any)
                .mockRejectedValueOnce(new Error("later page failed"));
            const result =
                kind === "played"
                    ? service.getAllGames("user")
                    : service.getUserTrophyTitles("user");
            await expect(result).rejects.toMatchObject({ outcome: "failed" });
            expect(request).toHaveBeenCalledTimes(2);
            expect(
                set.mock.calls.some(([key]) =>
                    /#(getAllGames|getUserTrophyTitles)__/.test(key),
                ),
            ).toBe(false);
        });
    },
);

it("bypasses the legacy cache namespace and caches a confirmed empty PSN library", async () => {
    const values = new Map<string, unknown>([
        [
            'PsnSyncService#getAllGames__["user"]',
            [{ titleId: "legacy-partial" }],
        ],
    ]);
    const set = jest.fn(async (key, value) => {
        values.set(key, value);
    });
    setCacheManager({
        get: jest.fn(async (key) => values.get(key)),
        set,
    } as any);
    gamesRequest.mockResolvedValue({ titles: [], totalItemCount: 0 } as any);
    await expect(service.getAllGames("user")).resolves.toEqual([]);
    await expect(service.getAllGames("user")).resolves.toEqual([]);
    expect(gamesRequest).toHaveBeenCalledTimes(1);
    expect(
        values.get('PsnSyncService:complete-v1#getAllGames__["user"]'),
    ).toEqual([]);
    expect(values.get('PsnSyncService#getAllGames__["user"]')).toEqual([
        { titleId: "legacy-partial" },
    ]);
});

it("lets a late PSN request settle but rejects it before caching or starting another page", async () => {
    jest.useFakeTimers();
    const set = jest.fn().mockResolvedValue(undefined);
    setCacheManager({
        get: jest.fn().mockResolvedValue(undefined),
        set,
    } as any);
    let finish!: (value: any) => void;
    gamesRequest.mockImplementationOnce(
        () =>
            new Promise((resolve) => {
                finish = resolve;
            }),
    );
    try {
        const pending = runPlayerSyncAttempt(() =>
            service.getAllGames("late-user"),
        );
        const assertion = expect(pending).rejects.toThrow(
            "attempt deadline exceeded",
        );
        await jest.advanceTimersByTimeAsync(PLAYER_ATTEMPT_TIMEOUT_MS);
        expect(gamesRequest).toHaveBeenCalledTimes(1);
        finish({ titles: [{ titleId: "1" }], totalItemCount: 2 });
        await assertion;
        expect(gamesRequest).toHaveBeenCalledTimes(1);
        expect(set).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
    } finally {
        jest.useRealTimers();
    }
});

beforeEach(() => setPlayerProviderBudget({ run: (_provider, work) => work() }));
