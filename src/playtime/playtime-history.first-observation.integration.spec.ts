import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DataSource, Repository } from "typeorm";
import {
    addTransactionalDataSource,
    deleteDataSourceByName,
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { createBaselineTables } from "../../test/baseline-schema";
import { AddPlaytimeHistoryProfilePeriod1795200000000 } from "../migrations/1795200000000-AddPlaytimeHistoryProfilePeriod";
import { setCacheManager } from "../utils/cacheable";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { PlaytimeHistoryService } from "./playtime-history.service";
import { PlaytimeService } from "./playtime.service";
import { UserPlaytimeSource } from "./playtime.constants";

const mysqlDescribe = process.env.PLAYER_IMPORT_TEST_MYSQL_PORT
    ? describe
    : describe.skip;

const HOUR_SECONDS = 3_600;
const SWITCH_PLATFORM_ID = 130;
const PS5_PLATFORM_ID = 167;
const XBOX_ONE_PLATFORM_ID = 49;
const XBOX_SERIES_PLATFORM_ID = 169;
const PC_PLATFORM_ID = 6;

const at = (date: string) => new Date(date);

const row = (
    profileUserId: string,
    source: UserPlaytimeSource,
    platformId: number,
    gameId: number,
    totalPlaytimeSeconds: number,
    createdAt: string,
    dates: { firstPlayedDate?: string; lastPlayedDate?: string } = {},
) => ({
    profileUserId,
    source,
    platformId,
    gameId,
    totalPlaytimeSeconds,
    recentPlaytimeSeconds: 0,
    firstPlayedDate: dates.firstPlayedDate ? at(dates.firstPlayedDate) : null,
    lastPlayedDate: dates.lastPlayedDate ? at(dates.lastPlayedDate) : null,
    createdAt: at(createdAt),
});

mysqlDescribe(
    "First-observation playtime estimates on disposable MySQL",
    () => {
        const database = `playtime_first_obs_test_${randomUUID().replaceAll("-", "")}`;
        let source: DataSource;
        let admin: DataSource;
        let historyRepository: Repository<UserPlaytimeHistory>;
        let history: PlaytimeHistoryService;

        beforeAll(async () => {
            setCacheManager({
                get: jest.fn().mockResolvedValue(undefined),
                set: jest.fn().mockResolvedValue(undefined),
            } as any);
            const options = {
                type: "mysql" as const,
                host: "127.0.0.1",
                port: Number(process.env.PLAYER_IMPORT_TEST_MYSQL_PORT),
                username: "root",
                password: "",
                timezone: "Z",
                connectTimeout: 5000,
            };
            initializeTransactionalContext({
                storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
            });
            admin = await new DataSource(options).initialize();
            await admin.query(`CREATE DATABASE \`${database}\``);
            source = await new DataSource({
                ...options,
                database,
                entities: [resolve(__dirname, "..", "**/*.entity.ts")],
            }).initialize();
            addTransactionalDataSource(source);
            await createBaselineTables(source, [
                "user_playtime",
                "user_playtime_history",
            ]);
            const runner = source.createQueryRunner();
            try {
                await new AddPlaytimeHistoryProfilePeriod1795200000000().up(
                    runner,
                );
            } finally {
                await runner.release();
            }
            historyRepository = source.getRepository(UserPlaytimeHistory);
            history = new PlaytimeHistoryService(historyRepository, {} as any);
        });

        afterAll(async () => {
            deleteDataSourceByName("default");
            if (source?.isInitialized) await source.destroy();
            if (admin?.isInitialized) {
                await admin.query(`DROP DATABASE \`${database}\``);
                await admin.destroy();
            }
        });

        const read = async (
            userId: string,
            startDate: string,
            endDate: string,
            sourceName?: UserPlaytimeSource,
            platformId?: number,
        ) =>
            new Map(
                (
                    await history.getTotalPlaytimeForPeriod({
                        userId,
                        startDate: at(startDate),
                        endDate: at(endDate),
                        source: sourceName,
                        platformId,
                    })
                ).map((total) => [
                    `${total.source}:${total.gameId}:${total.platformId}`,
                    {
                        total: total.totalPlaytimeInPeriodSeconds,
                        estimated: total.estimatedPlaytimeSeconds ?? 0,
                    },
                ]),
            );

        it("counts a Nintendo game first played inside the week once, plus the next delta", async () => {
            const userId = randomUUID();
            await historyRepository.insert([
                row(
                    userId,
                    UserPlaytimeSource.NSWITCH,
                    SWITCH_PLATFORM_ID,
                    1,
                    7_200,
                    "2026-11-16T15:10:00Z",
                    {
                        firstPlayedDate: "2026-11-16T01:49:00Z",
                        lastPlayedDate: "2026-11-16T11:38:00Z",
                    },
                ),
                row(
                    userId,
                    UserPlaytimeSource.NSWITCH,
                    SWITCH_PLATFORM_ID,
                    1,
                    11_700,
                    "2026-11-17T15:10:00Z",
                    {
                        firstPlayedDate: "2026-11-16T01:49:00Z",
                        lastPlayedDate: "2026-11-17T12:00:00Z",
                    },
                ),
            ]);

            expect(
                await read(
                    userId,
                    "2026-11-11T12:00:00Z",
                    "2026-11-18T12:00:00Z",
                ),
            ).toEqual(
                new Map([
                    ["nswitch:1:130", { total: 11_700, estimated: 7_200 }],
                ]),
            );
            // The first row stays the baseline: a window after it holds only the delta.
            expect(
                await read(
                    userId,
                    "2026-11-16T15:10:00Z",
                    "2026-11-18T12:00:00Z",
                ),
            ).toEqual(
                new Map([["nswitch:1:130", { total: 4_500, estimated: 0 }]]),
            );
            expect(
                await read(
                    userId,
                    "2026-11-04T12:00:00Z",
                    "2026-11-11T12:00:00Z",
                ),
            ).toEqual(new Map());
        });

        it("spreads an initial PSN import's lifetime total from its first played date", async () => {
            const userId = randomUUID();
            await historyRepository.insert(
                row(
                    userId,
                    UserPlaytimeSource.PSN,
                    PS5_PLATFORM_ID,
                    2,
                    200 * HOUR_SECONDS,
                    "2026-11-15T12:00:00Z",
                    {
                        firstPlayedDate: "2024-01-01T00:00:00Z",
                        lastPlayedDate: "2026-11-10T00:00:00Z",
                    },
                ),
            );

            expect(
                await read(
                    userId,
                    "2026-11-08T12:00:00Z",
                    "2026-11-15T12:00:00Z",
                ),
            ).toEqual(
                new Map([["psn:2:167", { total: 1_034, estimated: 1_034 }]]),
            );
            expect(
                await read(
                    userId,
                    "2026-11-01T12:00:00Z",
                    "2026-11-08T12:00:00Z",
                ),
            ).toEqual(
                new Map([["psn:2:167", { total: 4_828, estimated: 4_828 }]]),
            );
            expect(
                await read(
                    userId,
                    "2023-01-01T00:00:00Z",
                    "2026-11-16T00:00:00Z",
                ),
            ).toEqual(
                new Map([
                    [
                        "psn:2:167",
                        {
                            total: 200 * HOUR_SECONDS,
                            estimated: 200 * HOUR_SECONDS,
                        },
                    ],
                ]),
            );
            // Earlier windows get their share too, but nothing before the first play.
            expect(
                await read(
                    userId,
                    "2025-01-01T00:00:00Z",
                    "2026-01-01T00:00:00Z",
                ),
            ).toEqual(
                new Map([
                    ["psn:2:167", { total: 251_724, estimated: 251_724 }],
                ]),
            );
            expect(
                await read(
                    userId,
                    "2023-01-01T00:00:00Z",
                    "2024-01-01T00:00:00Z",
                ),
            ).toEqual(new Map());
        });

        it("counts Xbox games new to an already syncing connection, but not the initial import, platform flips or stale games", async () => {
            const userId = randomUUID();
            const firstSync = "2026-11-10T12:00:00Z";
            const secondSync = "2026-11-14T12:00:00Z";
            const xbox = (
                platformId: number,
                gameId: number,
                total: number,
                createdAt: string,
                lastPlayedDate?: string,
            ) =>
                row(
                    userId,
                    UserPlaytimeSource.XBOX,
                    platformId,
                    gameId,
                    total,
                    createdAt,
                    { lastPlayedDate },
                );
            await historyRepository.insert([
                xbox(XBOX_SERIES_PLATFORM_ID, 10, 1_000, firstSync, firstSync),
                xbox(XBOX_ONE_PLATFORM_ID, 11, 5_000, firstSync, firstSync),
                // New game played since the previous sync.
                xbox(
                    XBOX_SERIES_PLATFORM_ID,
                    12,
                    HOUR_SECONDS,
                    secondSync,
                    "2026-11-14T10:00:00Z",
                ),
                // Preferred platform switched: lifetime total on a new key.
                xbox(
                    XBOX_SERIES_PLATFORM_ID,
                    11,
                    5_000,
                    secondSync,
                    "2026-11-14T10:00:00Z",
                ),
                // Newly listed but last played before the previous sync.
                xbox(
                    XBOX_SERIES_PLATFORM_ID,
                    13,
                    2_000,
                    secondSync,
                    "2026-11-09T00:00:00Z",
                ),
                // No last played date: spread over the whole gap between syncs.
                xbox(XBOX_SERIES_PLATFORM_ID, 14, 960, secondSync),
            ]);

            expect(
                await read(
                    userId,
                    "2026-11-08T12:00:00Z",
                    "2026-11-15T12:00:00Z",
                ),
            ).toEqual(
                new Map([
                    ["xbox:10:169", { total: 0, estimated: 0 }],
                    ["xbox:11:49", { total: 0, estimated: 0 }],
                    [
                        "xbox:12:169",
                        { total: HOUR_SECONDS, estimated: HOUR_SECONDS },
                    ],
                    ["xbox:11:169", { total: 0, estimated: 0 }],
                    ["xbox:13:169", { total: 0, estimated: 0 }],
                    ["xbox:14:169", { total: 960, estimated: 960 }],
                ]),
            );
            // Game 14's four days between syncs split across two windows.
            expect(
                (
                    await read(
                        userId,
                        "2026-11-12T12:00:00Z",
                        "2026-11-13T12:00:00Z",
                    )
                ).get("xbox:14:169"),
            ).toEqual({ total: 240, estimated: 240 });
        });

        it("keeps Epic and GOG first observations at zero even after an earlier sync", async () => {
            const userId = randomUUID();
            await historyRepository.insert([
                row(
                    userId,
                    UserPlaytimeSource.EPICGAMES,
                    PC_PLATFORM_ID,
                    20,
                    100,
                    "2026-11-10T12:00:00Z",
                ),
                row(
                    userId,
                    UserPlaytimeSource.EPICGAMES,
                    PC_PLATFORM_ID,
                    21,
                    HOUR_SECONDS,
                    "2026-11-14T12:00:00Z",
                    { lastPlayedDate: "2026-11-14T12:00:00Z" },
                ),
                row(
                    userId,
                    UserPlaytimeSource.GOG,
                    PC_PLATFORM_ID,
                    22,
                    100,
                    "2026-11-10T12:00:00Z",
                ),
                row(
                    userId,
                    UserPlaytimeSource.GOG,
                    PC_PLATFORM_ID,
                    23,
                    HOUR_SECONDS,
                    "2026-11-14T12:00:00Z",
                ),
            ]);

            const totals = await read(
                userId,
                "2026-11-08T12:00:00Z",
                "2026-11-15T12:00:00Z",
            );
            expect(totals.size).toBe(4);
            expect(
                [...totals.values()].every(
                    ({ total, estimated }) => total === 0 && estimated === 0,
                ),
            ).toBe(true);
        });

        it("honors the source and platform filters", async () => {
            const userId = randomUUID();
            const dates = {
                firstPlayedDate: "2026-11-14T00:00:00Z",
                lastPlayedDate: "2026-11-14T02:00:00Z",
            };
            await historyRepository.insert([
                row(
                    userId,
                    UserPlaytimeSource.PSN,
                    PS5_PLATFORM_ID,
                    30,
                    HOUR_SECONDS,
                    "2026-11-14T12:00:00Z",
                    dates,
                ),
                row(
                    userId,
                    UserPlaytimeSource.PSN,
                    48,
                    31,
                    2 * HOUR_SECONDS,
                    "2026-11-14T12:00:00Z",
                    dates,
                ),
                row(
                    userId,
                    UserPlaytimeSource.NSWITCH,
                    SWITCH_PLATFORM_ID,
                    32,
                    3 * HOUR_SECONDS,
                    "2026-11-14T12:00:00Z",
                    dates,
                ),
            ]);
            const window = [
                "2026-11-08T12:00:00Z",
                "2026-11-15T12:00:00Z",
            ] as const;

            expect([...(await read(userId, ...window)).keys()].sort()).toEqual([
                "nswitch:32:130",
                "psn:30:167",
                "psn:31:48",
            ]);
            expect(
                await read(userId, ...window, UserPlaytimeSource.PSN),
            ).toEqual(
                new Map([
                    [
                        "psn:30:167",
                        { total: HOUR_SECONDS, estimated: HOUR_SECONDS },
                    ],
                    [
                        "psn:31:48",
                        {
                            total: 2 * HOUR_SECONDS,
                            estimated: 2 * HOUR_SECONDS,
                        },
                    ],
                ]),
            );
            expect(
                await read(
                    userId,
                    ...window,
                    UserPlaytimeSource.PSN,
                    PS5_PLATFORM_ID,
                ),
            ).toEqual(
                new Map([
                    [
                        "psn:30:167",
                        { total: HOUR_SECONDS, estimated: HOUR_SECONDS },
                    ],
                ]),
            );
            expect(
                await read(userId, ...window, UserPlaytimeSource.XBOX),
            ).toEqual(new Map());
        });

        it("feeds a Nintendo game's first observation into the imported recent playtime", async () => {
            const userId = randomUUID();
            const playtimes = new PlaytimeService(
                source.getRepository(UserPlaytime),
                history,
            );
            const [saved] = await playtimes.saveImported(
                [
                    {
                        profileUserId: userId,
                        gameId: 40,
                        platformId: SWITCH_PLATFORM_ID,
                        source: UserPlaytimeSource.NSWITCH,
                        totalPlaytimeSeconds: 7_200,
                        recentPlaytimeSeconds: undefined,
                        firstPlayedDate: new Date(
                            Date.now() - 10 * HOUR_SECONDS,
                        ),
                        lastPlayedDate: new Date(Date.now() - HOUR_SECONDS),
                        totalPlayCount: 0,
                    },
                ],
                new Map(),
            );
            expect(saved.recentPlaytimeSeconds).toBe(7_200);
        });
    },
);
