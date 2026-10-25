import { ConnectionProviderRegistry } from "../../connection/connection-provider.registry";
import {
    playerStateFixture,
    playerOwner,
} from "../../sync/player-data/player-sync.fixture";
import { PLAYTIME_WATCH_QUEUE_JOB_NAME } from "./playtime-watch.constants";
import { PlaytimeWatchProcessor } from "./playtime-watch.processor";
import { XboxSyncService } from "../../sync/xbox/xbox-sync.service";
import { callXboxAPI } from "../../sync/xbox/client/callXboxApi";
import { setCacheManager } from "../../utils/cacheable";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { generateChecksum } from "../../utils/checksum";
import { EConnectionType } from "../../connection/connections.constants";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";

dayjs.extend(duration);

function batchPlaytimeFixture(service: any) {
    return {
        ...service,
        findForImport: jest.fn(
            async (userId: string, source: string, gameIds: number[]) => {
                const rows = await Promise.all(
                    gameIds.map(
                        async (gameId) =>
                            [gameId, await service.findOne?.()] as const,
                    ),
                );
                return new Map(
                    rows
                        .filter(([, row]) => row)
                        .map(([gameId, row]) => [
                            `${gameId}:${source === "steam" ? 6 : 49}`,
                            row,
                        ]),
                );
            },
        ),
        saveImported: jest.fn(async (playtimes) => {
            for (const playtime of playtimes) await service.save(playtime);
        }),
    };
}

jest.mock("../../sync/xbox/client/callXboxApi", () => ({
    callXboxAPI: jest.fn(),
}));

test("playtime executes the registered handler and rejects missing capabilities", async () => {
    const registry = new ConnectionProviderRegistry();
    const processor = new PlaytimeWatchProcessor(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        registry,
    );
    const handler = jest.fn().mockResolvedValue({ outcome: "empty" });
    registry.register({
        ...registry.get("steam"),
        type: "future" as any,
        syncHandlers: { fetchPlaytime: handler },
    });
    const job = { data: { userId: "user" } } as any;
    await expect(processor.updatePlaytimeInfo("future", job)).resolves.toEqual({
        outcome: "empty",
    });
    expect(handler).toHaveBeenCalledWith(job);
    registry.get("future").syncHandlers = {};
    await expect(
        processor.updatePlaytimeInfo("future", job),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
});

test("a capped TitleHub response leaves previous playtime and queued achievements untouched", async () => {
    setCacheManager({
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn(),
    } as any);
    jest.mocked(callXboxAPI).mockResolvedValue({
        titles: Array(5000).fill({ titleId: "1" }),
    } as any);
    const xbox = new XboxSyncService(
        { getUserAuthCredentials: jest.fn().mockResolvedValue({}) } as any,
        {} as any,
    );
    const save = jest.fn();
    const enqueue = jest.fn();
    const processor = new PlaytimeWatchProcessor(
        batchPlaytimeFixture({ save }) as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        xbox,
        {} as any,
        {} as any,
        { addUserSyncJob: enqueue } as any,
        new ConnectionProviderRegistry(),
    );
    await expect(
        processor.updateXboxPlaytimeInfo({ data: { userId: "user" } } as any),
    ).rejects.toThrow("Incomplete Xbox TitleHub");
    expect(save).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
});

test("a late PSN library cannot reach playtime writes or achievement admission", async () => {
    const {
        runPlayerSyncAttempt,
        PLAYER_ATTEMPT_TIMEOUT_MS,
    } = require("../../sync/player-sync-attempt");
    jest.useFakeTimers();
    let finish!: (value: any[]) => void;
    const save = jest.fn();
    const enqueue = jest.fn();
    const processor = new PlaytimeWatchProcessor(
        batchPlaytimeFixture({ save }) as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {
            getExternalGamesForSourceIds: jest.fn().mockResolvedValue([]),
            registerUnmappedGame: jest.fn(),
        } as any,
        {} as any,
        {} as any,
        {
            getAllGames: jest.fn(
                () =>
                    new Promise((resolve) => {
                        finish = resolve;
                    }),
            ),
            getUserTrophyTitles: jest.fn().mockResolvedValue([]),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        { addUserSyncJob: enqueue } as any,
        new ConnectionProviderRegistry(),
    );
    try {
        const pending = runPlayerSyncAttempt(() =>
            processor.updatePsnPlaytimeInfo({
                data: { userId: "user" },
            } as any),
        );
        const assertion = expect(pending).rejects.toThrow(
            "attempt deadline exceeded",
        );
        await jest.advanceTimersByTimeAsync(PLAYER_ATTEMPT_TIMEOUT_MS);
        finish([{ name: "fixture", concept: { id: "1" } }]);
        await assertion;
        expect(save).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    } finally {
        jest.useRealTimers();
    }
});

it.each(["steam", "psn", "xbox"])(
    "reports a complete empty %s library as normal success",
    async (source) => {
        const save = jest.fn();
        const enqueue = jest.fn();
        const processor = new PlaytimeWatchProcessor(
            batchPlaytimeFixture({ save }) as any,
            {
                findOneByUserIdAndTypeOrFail: jest
                    .fn()
                    .mockResolvedValue({ sourceUserId: "fixture" }),
            } as any,
            {} as any,
            {} as any,
            { getLibraryGames: jest.fn().mockResolvedValue([]) } as any,
            {
                getAllGames: jest.fn().mockResolvedValue([]),
                getUserTrophyTitles: jest.fn().mockResolvedValue([]),
            } as any,
            { getAllGames: jest.fn().mockResolvedValue([]) } as any,
            {} as any,
            { sendMessageToUser: jest.fn() } as any,
            { addUserSyncJob: enqueue } as any,
            new ConnectionProviderRegistry(),
        );
        const updateProgress = jest.fn().mockResolvedValue(undefined);
        const job = {
            name: PLAYTIME_WATCH_QUEUE_JOB_NAME,
            data: {
                userId: "user",
                source,
                owner: playerOwner("user", source),
            },
            updateProgress,
        } as any;
        // Use the actual queue name constant so this also checks worker dispatch.
        job.name =
            require("./playtime-watch.constants").PLAYTIME_WATCH_QUEUE_JOB_NAME;
        if (source === "steam") await processor.updateSteamPlaytimeInfo(job);
        else if (source === "psn") await processor.updatePsnPlaytimeInfo(job);
        else await processor.updateXboxPlaytimeInfo(job);
        expect(updateProgress).toHaveBeenCalledWith({ totalUpdatedGames: 0 });
        expect(save).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    },
);

test("legacy jobs never reach provider work", async () => {
    const {
        PlayerSyncOwnershipLost,
    } = require("../../sync/player-data/player-sync-state.service");
    const state = playerStateFixture();
    state.runOwned.mockRejectedValue(new PlayerSyncOwnershipLost());
    const processor = new PlaytimeWatchProcessor(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        new ConnectionProviderRegistry(),
    );
    const fetch = jest.spyOn(processor, "updateSteamPlaytimeInfo");
    await expect(
        processor.process({
            name: PLAYTIME_WATCH_QUEUE_JOB_NAME,
            data: {
                userId: "user",
                source: "steam",
                owner: playerOwner("user"),
            },
        } as any),
    ).resolves.toEqual({ outcome: "legacy-skip" });
    expect(fetch).not.toHaveBeenCalled();
});

test("Steam selection uses recent-list data for timestamp-free and Family Sharing games", async () => {
    const owned = [
        {
            game: { id: 42 },
            name: "Recent override",
            minutes: 5,
            recentMinutes: 0,
            lastPlayedTimestamp: 123,
        },
    ];
    const snapshots = [
        [
            {
                game: { id: 42 },
                name: "Recent override",
                minutes: 90,
                recentMinutes: 10,
            },
            {
                game: { id: 43 },
                name: "Family Sharing",
                minutes: 60,
                recentMinutes: 3,
            },
        ],
        [
            {
                game: { id: 42 },
                name: "Recent override",
                minutes: 100,
                recentMinutes: 11,
            },
            {
                game: { id: 43 },
                name: "Family Sharing",
                minutes: 60,
                recentMinutes: 4,
            },
        ],
    ];
    const steam = Object.assign(Object.create(SteamSyncService.prototype), {
        getAllGames: jest.fn().mockResolvedValue(owned),
        getRecentlyPlayedGames: jest
            .fn()
            .mockResolvedValueOnce(snapshots[0])
            .mockResolvedValueOnce(snapshots[1]),
    });
    const mappedGames = [
        { id: 501, gameId: 101, uid: "42", name: "Recent override" },
        { id: 502, gameId: 102, uid: "43", name: "Family Sharing" },
    ];
    const enqueue = jest.fn();
    const processor = new PlaytimeWatchProcessor(
        batchPlaytimeFixture({
            findOne: jest.fn().mockResolvedValue(undefined),
            save: jest.fn(),
        }) as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {
            getExternalGamesForSourceIds: jest
                .fn()
                .mockResolvedValue(mappedGames),
            registerUnmappedGame: jest.fn(),
        } as any,
        {} as any,
        steam,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { addUserSyncJob: enqueue } as any,
        new ConnectionProviderRegistry(),
    );
    const job = { data: { userId: "user" }, updateProgress: jest.fn() } as any;

    await processor.updateSteamPlaytimeInfo(job);
    await processor.updateSteamPlaytimeInfo(job);

    expect(steam.getAllGames).toHaveBeenCalledTimes(2);
    expect(steam.getRecentlyPlayedGames).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(
        1,
        "user",
        501,
        EConnectionType.STEAM,
        generateChecksum([[42, 90, 10]]),
    );
    expect(enqueue).toHaveBeenNthCalledWith(
        2,
        "user",
        502,
        EConnectionType.STEAM,
        generateChecksum([[43, 60, 3]]),
    );
    expect(enqueue).toHaveBeenNthCalledWith(
        3,
        "user",
        501,
        EConnectionType.STEAM,
        generateChecksum([[42, 100, 11]]),
    );
    expect(enqueue).toHaveBeenNthCalledWith(
        4,
        "user",
        502,
        EConnectionType.STEAM,
        generateChecksum([[43, 60, 4]]),
    );
});

test("PSN title progress fingerprints keep same-service communication IDs distinct", async () => {
    const mappings = [
        { npCommunicationId: "comm-a", npServiceName: "trophy2" },
        { npCommunicationId: "comm-b", npServiceName: "trophy2" },
    ];
    const userTrophyTitles = [
        {
            npCommunicationId: "comm-b",
            npServiceName: "trophy2",
            trophySetVersion: "1",
            lastUpdatedDateTime: "2026-10-20T00:00:00Z",
            progress: 30,
            earnedTrophies: { bronze: 3, silver: 0, gold: 0, platinum: 0 },
        },
        {
            npCommunicationId: "comm-a",
            npServiceName: "trophy2",
            trophySetVersion: "1",
            lastUpdatedDateTime: "2026-10-20T00:00:00Z",
            progress: 15,
            earnedTrophies: { bronze: 1, silver: 0, gold: 0, platinum: 0 },
        },
    ];
    const changedTrophyTitles = [
        userTrophyTitles[0],
        {
            ...userTrophyTitles[1],
            lastUpdatedDateTime: "2026-10-24T00:00:00Z",
            progress: 16,
        },
    ];
    const userGames = [
        {
            concept: { id: "1" },
            category: "ps4_game",
            firstPlayedDateTime: "2025-01-01T00:00:00Z",
            lastPlayedDateTime: "2026-10-20T00:00:00Z",
            playDuration: "PT1H",
            playCount: 1,
        },
    ];
    const enqueue = jest.fn();
    const upsertPsnMappings = jest.fn().mockResolvedValue(undefined);
    const processor = new PlaytimeWatchProcessor(
        batchPlaytimeFixture({
            findOne: jest.fn().mockResolvedValue(undefined),
            save: jest.fn(),
        }) as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {
            getExternalGamesForSourceIds: jest.fn().mockResolvedValue([
                {
                    id: 503,
                    uid: "1",
                    gameId: 103,
                    name: "Mapped PSN game",
                    psnExtraMappings: mappings,
                },
            ]),
            registerUnmappedGame: jest.fn(),
        } as any,
        { upsertPsnMappings } as any,
        {} as any,
        {
            getAllGames: jest.fn().mockResolvedValue(userGames),
            getUserTrophyTitles: jest
                .fn()
                .mockResolvedValueOnce(userTrophyTitles)
                .mockResolvedValueOnce(changedTrophyTitles),
        } as any,
        {} as any,
        {
            getGamePlatformsMap: jest
                .fn()
                .mockResolvedValue(
                    new Map([["PS4", { id: 48, abbreviation: "PS4" }]]),
                ),
        } as any,
        {} as any,
        { addUserSyncJob: enqueue } as any,
        new ConnectionProviderRegistry(),
    );
    const job = { data: { userId: "user" }, updateProgress: jest.fn() } as any;

    await processor.updatePsnPlaytimeInfo(job);
    await processor.updatePsnPlaytimeInfo(job);

    expect(upsertPsnMappings).toHaveBeenCalledTimes(4);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue.mock.calls[0]).toEqual([
        "user",
        503,
        EConnectionType.PSN,
        generateChecksum([
            [
                "comm-a:trophy2",
                "1",
                "2026-10-20T00:00:00Z",
                15,
                { bronze: 1, silver: 0, gold: 0, platinum: 0 },
            ],
            [
                "comm-b:trophy2",
                "1",
                "2026-10-20T00:00:00Z",
                30,
                { bronze: 3, silver: 0, gold: 0, platinum: 0 },
            ],
        ]),
    ]);
    expect(enqueue.mock.calls[1][3]).not.toBe(enqueue.mock.calls[0][3]);
    expect(enqueue.mock.calls[1][3]).toBe(
        generateChecksum([
            [
                "comm-a:trophy2",
                "1",
                "2026-10-24T00:00:00Z",
                16,
                { bronze: 1, silver: 0, gold: 0, platinum: 0 },
            ],
            [
                "comm-b:trophy2",
                "1",
                "2026-10-20T00:00:00Z",
                30,
                { bronze: 3, silver: 0, gold: 0, platinum: 0 },
            ],
        ]),
    );
});

test("Xbox achievement selection follows title progress when playtime stats are absent", async () => {
    const titles = [
        {
            productId: "product",
            titleId: "title",
            achievement: { currentAchievements: 1, totalAchievements: 5 },
            titleHistory: { lastTimePlayed: null },
            devices: [],
        },
        {
            productId: "product",
            titleId: "title",
            achievement: { currentAchievements: 2, totalAchievements: 5 },
            titleHistory: { lastTimePlayed: null },
            devices: [],
        },
    ];
    const events: string[] = [];
    const enqueue = jest.fn(async () => events.push("achievement"));
    const getBatchMinutesPlayed = jest.fn(async () => {
        events.push("statistics");
        return [];
    });
    const processor = new PlaytimeWatchProcessor(
        batchPlaytimeFixture({ findOne: jest.fn(), save: jest.fn() }) as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {
            getExternalGamesForSourceIds: jest
                .fn()
                .mockResolvedValue([
                    { id: 601, uid: "product", gameId: 701, name: "Xbox game" },
                ]),
            registerUnmappedGame: jest.fn(),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {
            getAllGames: jest
                .fn()
                .mockResolvedValueOnce([titles[0]])
                .mockResolvedValueOnce([titles[1]]),
            getBatchMinutesPlayed,
        } as any,
        { getGamePlatformsMap: jest.fn().mockResolvedValue(new Map()) } as any,
        {} as any,
        { addUserSyncJob: enqueue } as any,
        new ConnectionProviderRegistry(),
    );
    const job = { data: { userId: "user" }, updateProgress: jest.fn() } as any;

    await processor.updateXboxPlaytimeInfo(job);
    await processor.updateXboxPlaytimeInfo(job);

    expect(events).toEqual([
        "achievement",
        "statistics",
        "achievement",
        "statistics",
    ]);
    expect(getBatchMinutesPlayed).toHaveBeenNthCalledWith(1, "account", [
        "title",
    ]);
    expect(enqueue).toHaveBeenNthCalledWith(
        1,
        "user",
        601,
        EConnectionType.XBOX,
        generateChecksum([
            "title",
            { currentAchievements: 1, totalAchievements: 5 },
            null,
        ]),
    );
    expect(enqueue).toHaveBeenNthCalledWith(
        2,
        "user",
        601,
        EConnectionType.XBOX,
        generateChecksum([
            "title",
            { currentAchievements: 2, totalAchievements: 5 },
            null,
        ]),
    );
});

test("PSN maps persist before one enqueue per concept and same-name titles stay unmapped", async () => {
    const category = EGameExternalGameCategory.PlaystationStoreUs;
    const userGames = [
        {
            concept: { id: "1" },
            name: "Same display name",
            category: "ps4_game",
            firstPlayedDateTime: "2025-01-01T00:00:00Z",
            lastPlayedDateTime: "2026-10-20T00:00:00Z",
            playDuration: "PT1H",
            playCount: 1,
        },
        {
            concept: { id: "1" },
            name: "Same display name",
            category: "ps5_native_game",
            firstPlayedDateTime: "2025-01-01T00:00:00Z",
            lastPlayedDateTime: "2026-10-20T00:00:00Z",
            playDuration: "PT1H",
            playCount: 1,
        },
        {
            concept: { id: "2" },
            name: "Same display name",
            category: "ps4_game",
            firstPlayedDateTime: "2025-01-01T00:00:00Z",
            lastPlayedDateTime: "2026-10-20T00:00:00Z",
            playDuration: "PT1H",
            playCount: 1,
        },
    ];
    const mappings = [
        {
            externalGameId: 503,
            npCommunicationId: "verified-concept",
            npServiceName: "trophy2",
        },
    ];
    const externalGame = {
        id: 503,
        uid: "1",
        gameId: 103,
        name: "Same display name",
        psnExtraMappings: mappings,
    };
    const titles = [
        {
            npCommunicationId: "verified-concept",
            npServiceName: "trophy2",
            trophySetVersion: "1",
            lastUpdatedDateTime: "2026-10-20T00:00:00Z",
            progress: 42,
            earnedTrophies: { bronze: 2, silver: 0, gold: 0, platinum: 0 },
            titleName: "Same display name",
        },
        {
            npCommunicationId: "ambiguous-name-only",
            npServiceName: "trophy2",
            progress: 99,
            titleName: "Same display name",
        },
    ];
    const events: string[] = [];
    const upsertPsnMappings = jest.fn(async () => {
        events.push("mapping-started");
        await Promise.resolve();
        events.push("mapping-persisted");
    });
    const enqueue = jest.fn(async () => {
        events.push("enqueue");
    });
    const registerUnmappedGame = jest.fn().mockResolvedValue(undefined);
    const save = jest.fn();
    const processor = new PlaytimeWatchProcessor(
        batchPlaytimeFixture({
            findOne: jest.fn().mockResolvedValue(undefined),
            save,
        }) as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {
            getExternalGamesForSourceIds: jest
                .fn()
                .mockResolvedValue([externalGame]),
            registerUnmappedGame,
        } as any,
        { upsertPsnMappings } as any,
        {} as any,
        {
            getAllGames: jest.fn().mockResolvedValue(userGames),
            getUserTrophyTitles: jest.fn().mockResolvedValue(titles),
        } as any,
        {} as any,
        {
            getGamePlatformsMap: jest.fn().mockResolvedValue(
                new Map([
                    ["PS4", { id: 48, abbreviation: "PS4" }],
                    ["PS5", { id: 167, abbreviation: "PS5" }],
                ]),
            ),
        } as any,
        {} as any,
        { addUserSyncJob: enqueue } as any,
        new ConnectionProviderRegistry(),
    );

    await processor.updatePsnPlaytimeInfo({
        data: { userId: "user" },
        updateProgress: jest.fn(),
    } as any);

    expect(registerUnmappedGame).toHaveBeenCalledWith("2", category);
    expect(upsertPsnMappings).toHaveBeenCalledWith(mappings[0]);
    expect(events).toEqual(["mapping-started", "mapping-persisted", "enqueue"]);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
    expect(
        save.mock.calls.map(([playtime]) => playtime.totalPlayCount),
    ).toEqual([1, 1]);
    expect(enqueue).toHaveBeenCalledWith(
        "user",
        503,
        EConnectionType.PSN,
        generateChecksum([
            [
                "verified-concept:trophy2",
                "1",
                "2026-10-20T00:00:00Z",
                42,
                { bronze: 2, silver: 0, gold: 0, platinum: 0 },
            ],
        ]),
    );
    const admissionFailure = new Error("Redis unavailable");
    const previousEventCount = events.length;
    enqueue.mockRejectedValueOnce(admissionFailure);
    await expect(
        processor.updatePsnPlaytimeInfo({
            data: { userId: "user" },
            updateProgress: jest.fn(),
        } as any),
    ).rejects.toBe(admissionFailure);
    expect(events.slice(previousEventCount)).toEqual([
        "mapping-started",
        "mapping-persisted",
    ]);
});

it.each(["steam", "xbox"])(
    "%s preserves legacy counts under daily and four-times-daily polling",
    async (provider) => {
        async function replay(polls: number, initialCount?: number) {
            let existing: any =
                initialCount == null
                    ? undefined
                    : {
                          totalPlaytimeSeconds: 0,
                          totalPlayCount: initialCount,
                      };
            let poll = 0;
            const save = jest.fn(async (value) => {
                existing = value;
                return value;
            });
            const processor = new PlaytimeWatchProcessor(
                batchPlaytimeFixture({
                    findOne: jest.fn(async () => existing),
                    save,
                }) as any,
                {
                    findOneByUserIdAndTypeOrFail: jest
                        .fn()
                        .mockResolvedValue({ sourceUserId: "account" }),
                } as any,
                {
                    getExternalGamesForSourceIds: jest
                        .fn()
                        .mockResolvedValue([
                            { id: 1, gameId: 1, uid: "42", name: "fixture" },
                        ]),
                    registerUnmappedGame: jest.fn(),
                } as any,
                {} as any,
                {
                    getLibraryGames: jest.fn(async () => [
                        {
                            game: { id: 42 },
                            minutes: (++poll * 60) / polls,
                            recentMinutes: 0,
                        },
                    ]),
                } as any,
                {} as any,
                {
                    getAllGames: jest.fn().mockResolvedValue([
                        {
                            productId: "42",
                            titleId: "title",
                            devices: ["XboxOne"],
                            titleHistory: {},
                        },
                    ]),
                    getBatchMinutesPlayed: jest.fn(async () => [
                        {
                            titleid: "title",
                            value: String((++poll * 60) / polls),
                        },
                    ]),
                } as any,
                {
                    getGamePlatformsMap: jest
                        .fn()
                        .mockResolvedValue(new Map([["XONE", { id: 49 }]])),
                } as any,
                {} as any,
                { addUserSyncJob: jest.fn() } as any,
                new ConnectionProviderRegistry(),
            );
            const job = {
                data: { userId: "user" },
                updateProgress: jest.fn(),
            } as any;
            for (let i = 0; i < polls; i++) {
                if (provider === "steam")
                    await processor.updateSteamPlaytimeInfo(job);
                else await processor.updateXboxPlaytimeInfo(job);
            }
            return existing.totalPlayCount;
        }
        expect(await replay(1, 7)).toBe(7);
        expect(await replay(4, 7)).toBe(7);
        expect(await replay(4)).toBe(0);
    },
);

test("Steam editions sharing one game contribute once to its cumulative observation", async () => {
    const save = jest.fn();
    const processor = new PlaytimeWatchProcessor(
        batchPlaytimeFixture({
            findOne: jest.fn().mockResolvedValue(undefined),
            save,
        }) as any,
        {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
        } as any,
        {
            getExternalGamesForSourceIds: jest.fn().mockResolvedValue([
                { id: 1, gameId: 7, uid: "42" },
                { id: 2, gameId: 7, uid: "43" },
            ]),
            registerUnmappedGame: jest.fn(),
        } as any,
        {} as any,
        {
            getLibraryGames: jest.fn().mockResolvedValue([
                { game: { id: 42 }, minutes: 100, recentMinutes: 10 },
                { game: { id: 43 }, minutes: 60, recentMinutes: 5 },
            ]),
        } as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        { addUserSyncJob: jest.fn() } as any,
        new ConnectionProviderRegistry(),
    );
    await processor.updateSteamPlaytimeInfo({
        data: { userId: "owner" },
        updateProgress: jest.fn(),
    } as any);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
            gameId: 7,
            totalPlaytimeSeconds: 9600,
            recentPlaytimeSeconds: 900,
        }),
    );
});
