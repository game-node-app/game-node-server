import { EConnectionType } from "../../connection/connections.constants";
import { EImporterSource } from "../../importer/importer.constants";
import {
    connectionToImporterSource,
    importerToConnectionSource,
} from "../../importer/importer.util";
import { UserPlaytimeSource } from "../../playtime/playtime.constants";
import {
    connectionToPlaytimeImportSource,
    playtimeSourceToConnectionType,
} from "../../playtime/playtime.util";
import axios from "axios";
import { GogSyncService } from "./gog-sync.service";
import { setPlayerProviderBudget } from "../player-provider-budget.service";
import {
    runPlayerSyncAttempt,
    PLAYER_ATTEMPT_TIMEOUT_MS,
} from "../player-sync-attempt";
import library from "./fixtures/library-complete.json";
import emptyAchievements from "./fixtures/achievements-empty.json";
import zeroSessions from "./fixtures/sessions-zero.json";

jest.mock("axios");
const get = jest.mocked(axios.get);
const auth = { getAccessToken: jest.fn(async () => "access") };
const service = new GogSyncService(auth as any);
const release = (id: string, extra = {}) => ({
    platform_id: "gog",
    external_id: id,
    owned: true,
    ...extra,
});
const page = (items: unknown[], total = items.length, next?: string) => ({
    items,
    total_count: total,
    limit: 500,
    ...(next ? { next_page_token: next } : {}),
});
// Synthetic branch-test item, not an authenticated response capture.
const achievement = (id: string, date: string | null = null) => ({
    achievement_id: id,
    visible: true,
    name: "Title",
    description: "Description",
    image_url_unlocked: "https://images.gog.com/unlocked.png",
    image_url_locked: "https://images.gog.com/locked.png",
    date_unlocked: date,
});
const achievements = (items: unknown[]) => ({
    ...emptyAchievements.body,
    total_count: items.length,
    items,
});
beforeEach(() => {
    jest.resetAllMocks();
    auth.getAccessToken.mockResolvedValue("access");
    setPlayerProviderBudget({ run: (_key, work) => work() });
});

it("parses the captured complete library and retains all eight unplayed GOG games", async () => {
    get.mockResolvedValueOnce({ data: library.body });
    expect(await service.getLibraryItems("123")).toHaveLength(8);
});
it("finishes all pages, deduplicates IDs, filters unowned/foreign stores and shares the attempt snapshot", async () => {
    get.mockResolvedValueOnce({
        data: page([release("1"), release("2", { owned: false })], 5, "next"),
    }).mockResolvedValueOnce({
        data: page(
            [
                release("1"),
                release("3", { platform_id: "steam" }),
                release("4"),
            ],
            5,
        ),
    });
    await runPlayerSyncAttempt(async () => {
        expect(
            await Promise.all([
                service.getLibraryItems("123"),
                service.getLibraryItems("123"),
            ]),
        ).toEqual([
            ["1", "4"],
            ["1", "4"],
        ]);
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[1][1]?.params).toEqual({ page_token: "next" });
});
it("accepts only a confirmed empty library", async () => {
    get.mockResolvedValueOnce({ data: page([]) });
    expect(await service.getLibraryItems("123")).toEqual([]);
});
it.each([
    {},
    page([release("1")], 2),
    page([release("1")], 0),
    page([release("1", { owned: "true" })]),
    page([release("1", { external_id: 90000000000000001 })]),
    page([release("../other")]),
    { ...page([]), next_page_token: 7 },
])("rejects incomplete or malformed releases %#", async (data) => {
    get.mockResolvedValueOnce({ data });
    await expect(service.getLibraryItems("123")).rejects.toMatchObject({
        outcome: "incomplete",
    });
});
it("rejects a multi-token continuation cycle", async () => {
    get.mockResolvedValueOnce({ data: page([release("1")], 10, "a") })
        .mockResolvedValueOnce({ data: page([release("2")], 10, "b") })
        .mockResolvedValueOnce({ data: page([release("3")], 10, "a") });
    await expect(service.getLibraryItems("123")).rejects.toMatchObject({
        outcome: "incomplete",
    });
});
it("discards a failed later page and retries the snapshot from its beginning", async () => {
    await runPlayerSyncAttempt(async () => {
        get.mockResolvedValueOnce({
            data: page([release("1")], 2, "a"),
        }).mockRejectedValueOnce({ response: { status: 503 } });
        await expect(service.getLibraryItems("123")).rejects.toBeDefined();
        get.mockResolvedValueOnce({ data: page([release("2")]) });
        expect(await service.getLibraryItems("123")).toEqual(["2"]);
    });
});
it("accounts for throttling independently for each GOG account", async () => {
    const keys: string[] = [];
    setPlayerProviderBudget({
        run: async (key, work) => {
            keys.push(key);
            return work();
        },
    });
    get.mockRejectedValueOnce({
        response: { status: 429, headers: { "retry-after": "4" } },
    }).mockResolvedValueOnce({ data: page([]) });
    await expect(service.getLibraryItems("123")).rejects.toMatchObject({
        outcome: "throttled",
        retryAfterMs: 4000,
    });
    expect(await service.getLibraryItems("456")).toEqual([]);
    expect(keys).toEqual(["gog:user:123", "gog:user:456"]);
});
it("rejects a response after the attempt deadline", async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(now);
    get.mockImplementationOnce(async () => {
        clock.mockReturnValue(now + PLAYER_ATTEMPT_TIMEOUT_MS + 1);
        return { data: page([]) };
    });
    try {
        await expect(
            runPlayerSyncAttempt(() => service.getLibraryItems("123")),
        ).rejects.toMatchObject({ outcome: "failed" });
    } finally {
        clock.mockRestore();
    }
});
it("passes a cancellable signal and finite timeout to data requests", async () => {
    get.mockResolvedValueOnce({ data: page([]) });
    await service.getLibraryItems("123");
    expect(get.mock.calls[0][1]).toMatchObject({
        signal: expect.any(AbortSignal),
        timeout: 30000,
        maxRedirects: 0,
    });
});
it("distinguishes verified zero from absent time and converts minutes once", async () => {
    get.mockResolvedValueOnce({
        data: zeroSessions.body,
    }).mockResolvedValueOnce({ data: { time_sum: 12 } });
    expect(await service.getPlaytime("123", "1")).toBe(0);
    expect(await service.getPlaytime("123", "2")).toBe(720);
});
it.each([
    {},
    null,
    { time_sum: -1 },
    { time_sum: "12" },
    { time_sum: Infinity },
    { time_sum: 1e20 },
])("rejects invalid cumulative time %#", async (data) => {
    get.mockResolvedValueOnce({ data });
    await expect(service.getPlaytime("123", "1")).rejects.toMatchObject({
        outcome: "incomplete",
    });
});
it("shares catalogue/progress snapshots within one account/product/locale, isolating accounts", async () => {
    get.mockResolvedValueOnce({
        data: achievements([
            achievement("a", "2026-01-01T00:00:00Z"),
            achievement("b"),
        ]),
    }).mockResolvedValueOnce({ data: achievements([achievement("a")]) });
    await runPlayerSyncAttempt(async () => {
        const [one, again, two] = await Promise.all([
            service.getAchievements("123", "1"),
            service.getAchievements("123", "1"),
            service.getAchievements("456", "1"),
        ]);
        expect(one).toBe(again);
        expect(one[0].date_unlocked).not.toBeNull();
        expect(two[0].date_unlocked).toBeNull();
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1]?.headers).toMatchObject({
        "X-Gog-Lc": "en-US",
    });
});
it("keeps hidden definitions in a complete snapshot", async () => {
    get.mockResolvedValueOnce({
        data: achievements([
            { ...achievement("a"), visible: false, name: "", description: "" },
        ]),
    });
    expect(await service.getAchievements("123", "1")).toHaveLength(1);
});
it.each([
    {},
    { ...emptyAchievements.body, total_count: 1 },
    achievements([achievement("a", "not-a-date")]),
    achievements([achievement("a", "2026-02-30T00:00:00Z")]),
    achievements([achievement("a"), achievement("a")]),
    { ...achievements([achievement("a")]), achievements_mode: "only_unlocked" },
    { ...achievements([achievement("a")]), limit: 0 },
])("rejects ambiguous or truncated achievements %#", async (data) => {
    get.mockResolvedValueOnce({ data });
    await expect(service.getAchievements("123", "1")).rejects.toMatchObject({
        outcome: "incomplete",
    });
});
it("accepts the captured complete empty achievements set", async () => {
    get.mockResolvedValueOnce({ data: emptyAchievements.body });
    expect(await service.getAchievements("123", "1")).toEqual([]);
});
it.each([403, 404, 500])(
    "does not mistake HTTP %s for an unsupported/empty game",
    async (status) => {
        get.mockRejectedValueOnce({ response: { status } });
        await expect(
            service.getAchievements("123", "1"),
        ).rejects.not.toMatchObject({ outcome: "unsupported" });
    },
);
it("keeps curation registration when optional names fail and avoids refetching known names", async () => {
    const external = {
        findNamedUnmappedUids: jest.fn(async () => new Set(["2"])),
        registerUnmappedGames: jest.fn(),
    };
    get.mockRejectedValueOnce(new Error("unavailable"));
    await service.registerUnmappedGames(external as any, "owner", "123", [
        "1",
        "2",
    ]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(external.registerUnmappedGames).toHaveBeenCalledWith(
        5,
        [
            { sourceUid: "1", name: undefined },
            { sourceUid: "2", name: undefined },
        ],
        "owner",
    );
});
it("uses verified matching product metadata and excludes confirmed non-games", async () => {
    const external = {
        findNamedUnmappedUids: async () => new Set(),
        registerUnmappedGames: jest.fn(),
    };
    get.mockResolvedValueOnce({
        data: { id: 1, title: "Game", game_type: "game" },
    }).mockResolvedValueOnce({
        data: { id: 2, title: "Movie", game_type: "movie" },
    });
    await service.registerUnmappedGames(external as any, "owner", "123", [
        "1",
        "2",
    ]);
    expect(external.registerUnmappedGames).toHaveBeenCalledWith(
        5,
        [{ sourceUid: "1", name: "Game" }],
        "owner",
    );
});

it("keeps source conversions consistent for connection, importer and playtime", () => {
    expect(connectionToImporterSource(EConnectionType.GOG)).toBe(
        EImporterSource.GOG,
    );
    expect(importerToConnectionSource(EImporterSource.GOG)).toBe(
        EConnectionType.GOG,
    );
    expect(connectionToPlaytimeImportSource(EConnectionType.GOG)).toBe(
        UserPlaytimeSource.GOG,
    );
    expect(playtimeSourceToConnectionType(UserPlaytimeSource.GOG)).toBe(
        EConnectionType.GOG,
    );
});
it("fails cancellation before exposing a library snapshot", async () => {
    jest.useFakeTimers();
    get.mockImplementationOnce(
        (_url, config) =>
            new Promise((_resolve, reject) => {
                config?.signal?.addEventListener?.("abort", () =>
                    reject(new Error("cancelled")),
                );
            }),
    );
    try {
        const pending = service.getLibraryItems("123");
        const rejected = expect(pending).rejects.toMatchObject({
            outcome: "failed",
        });
        await jest.advanceTimersByTimeAsync(30001);
        await rejected;
    } finally {
        jest.useRealTimers();
    }
});
