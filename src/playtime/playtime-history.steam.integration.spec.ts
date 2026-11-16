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
import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";
import { AddPlaytimeHistoryProfilePeriod1795200000000 } from "../migrations/1795200000000-AddPlaytimeHistoryProfilePeriod";
import { ProfileMetricsSummaryService } from "../profile/profile-metrics/profile-metrics-summary.service";
import { setCacheManager } from "../utils/cacheable";
import { Period } from "../utils/period";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { PlaytimeHistoryService } from "./playtime-history.service";
import { PlaytimeService } from "./playtime.service";
import { PlaytimeWatchProcessor } from "./watch/playtime-watch.processor";
import { UserPlaytimeSource } from "./playtime.constants";

jest.mock("../profile/profile-metrics/profile-metrics-report.service", () => ({
    ProfileMetricsReportService: class ProfileMetricsReportService {},
}));
jest.mock("../game/game-repository/game-repository.service", () => ({
    GameRepositoryService: class GameRepositoryService {},
}));

const mysqlDescribe = process.env.PLAYER_IMPORT_TEST_MYSQL_PORT
    ? describe
    : describe.skip;

const DAY_MS = 86_400_000;
const HOUR_SECONDS = 3_600;
const PC_PLATFORM_ID = 6;
const PLAYSTATION_PLATFORM_ID = 48;
const NOW = new Date("2026-11-15T12:00:00.000Z");

const steam = (
    profileUserId: string,
    gameId: number,
    totalPlaytimeSeconds: number,
    recentPlaytimeSeconds: number,
    platformId = PC_PLATFORM_ID,
) => ({
    profileUserId,
    gameId,
    platformId,
    source: UserPlaytimeSource.STEAM,
    totalPlaytimeSeconds,
    recentPlaytimeSeconds,
    firstPlayedDate: null,
    lastPlayedDate: null,
    totalPlayCount: 0,
});

const withFrozenNow = async (now: Date, work: () => Promise<unknown>) => {
    jest.useFakeTimers({
        doNotFake: [
            "nextTick",
            "setImmediate",
            "clearImmediate",
            "setTimeout",
            "clearTimeout",
            "setInterval",
            "clearInterval",
            "queueMicrotask",
            "performance",
            "hrtime",
        ],
    });
    try {
        jest.setSystemTime(now);
        await work();
    } finally {
        jest.useRealTimers();
    }
};

mysqlDescribe(
    "Steam first-import playtime estimates on disposable MySQL",
    () => {
        const database = `playtime_steam_test_${randomUUID().replaceAll("-", "")}`;
        let source: DataSource;
        let admin: DataSource;
        let historyRepository: Repository<UserPlaytimeHistory>;
        let currentRepository: Repository<UserPlaytime>;
        let history: PlaytimeHistoryService;
        let playtimes: PlaytimeService;

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
                // Match the deployed schema, which adds this index after the baseline.
                await new AddPlaytimeHistoryProfilePeriod1795200000000().up(
                    runner,
                );
            } finally {
                await runner.release();
            }
            historyRepository = source.getRepository(UserPlaytimeHistory);
            currentRepository = source.getRepository(UserPlaytime);
            history = new PlaytimeHistoryService(historyRepository, {} as any);
            playtimes = new PlaytimeService(currentRepository, history);
        });

        afterAll(async () => {
            deleteDataSourceByName("default");
            if (source?.isInitialized) await source.destroy();
            if (admin?.isInitialized) {
                await admin.query(`DROP DATABASE \`${database}\``);
                await admin.destroy();
            }
        });

        const importRows = async (rows: ReturnType<typeof steam>[]) =>
            playtimes.saveImported(
                rows,
                await playtimes.findForImport(
                    rows[0].profileUserId,
                    UserPlaytimeSource.STEAM,
                    rows.map((row) => row.gameId),
                ),
            );

        const read = (
            userId: string,
            startDate: Date,
            endDate: Date,
            sourceName?: UserPlaytimeSource,
            platformId?: number,
        ) =>
            history.getTotalPlaytimeForPeriod({
                userId,
                startDate,
                endDate,
                source: sourceName,
                platformId,
            });

        it("splits the first Steam recent total across adjacent weeks and hides lifetime time", async () => {
            const userId = randomUUID();
            const library = [
                {
                    game: { id: 501, name: "Steam fixture" },
                    minutes: 60_000,
                    recentMinutes: 600,
                },
            ];
            const processor = new PlaytimeWatchProcessor(
                playtimes,
                {
                    findOneByUserIdAndTypeOrFail: async () => ({
                        sourceUserId: "steam-user",
                    }),
                } as any,
                {
                    getExternalGamesForSourceIds: async () => [
                        {
                            id: 1,
                            gameId: 501,
                            uid: "501",
                            name: "Steam fixture",
                        },
                    ],
                    registerUnmappedGames: async () => undefined,
                } as any,
                {} as any,
                { getLibraryGames: async () => library } as any,
                {} as any,
                {} as any,
                {} as any,
                { addUserSyncJob: async () => undefined } as any,
                new ConnectionProviderRegistry(),
                {} as any,
                {} as any,
                {} as any,
            );
            await withFrozenNow(NOW, async () => {
                await processor.updateSteamPlaytimeInfo({
                    data: { userId },
                    updateProgress: jest.fn(),
                } as any);
            });
            const [imported] = await currentRepository.findBy({
                profileUserId: userId,
            });
            expect({
                gameId: Number(imported.gameId),
                platformId: Number(imported.platformId),
                totalPlaytimeSeconds: imported.totalPlaytimeSeconds,
                recentPlaytimeSeconds: imported.recentPlaytimeSeconds,
            }).toEqual({
                gameId: 501,
                platformId: PC_PLATFORM_ID,
                totalPlaytimeSeconds: 60_000 * 60,
                recentPlaytimeSeconds: 600 * 60,
            });

            const previous = await read(
                userId,
                new Date(NOW.getTime() - 14 * DAY_MS),
                new Date(NOW.getTime() - 7 * DAY_MS),
            );
            const current = await read(
                userId,
                new Date(NOW.getTime() - 7 * DAY_MS),
                NOW,
            );
            expect(previous).toEqual([
                expect.objectContaining({
                    gameId: 501,
                    source: UserPlaytimeSource.STEAM,
                    platformId: PC_PLATFORM_ID,
                    totalPlaytimeInPeriodSeconds: 5 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 5 * HOUR_SECONDS,
                }),
            ]);
            expect(current).toEqual(previous);

            expect(
                await read(userId, new Date(NOW.getTime() - 30 * DAY_MS), NOW),
            ).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 10 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 10 * HOUR_SECONDS,
                }),
            ]);
            expect(
                await read(
                    userId,
                    new Date(NOW.getTime() - 60 * DAY_MS),
                    new Date(NOW.getTime() - 30 * DAY_MS),
                ),
            ).toEqual([]);
            expect(
                await read(userId, new Date(NOW.getTime() - 365 * DAY_MS), NOW),
            ).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 10 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 10 * HOUR_SECONDS,
                }),
            ]);
            expect(
                await read(
                    userId,
                    new Date(NOW.getTime() - 730 * DAY_MS),
                    new Date(NOW.getTime() - 365 * DAY_MS),
                ),
            ).toEqual([]);

            await withFrozenNow(new Date(NOW.getTime() + DAY_MS), async () => {
                await playtimes.saveImported(
                    [
                        {
                            profileUserId: imported.profileUserId,
                            gameId: Number(imported.gameId),
                            platformId: Number(imported.platformId),
                            source: imported.source,
                            totalPlaytimeSeconds: imported.totalPlaytimeSeconds,
                            recentPlaytimeSeconds:
                                imported.recentPlaytimeSeconds,
                            firstPlayedDate: imported.firstPlayedDate,
                            lastPlayedDate: imported.lastPlayedDate,
                            totalPlayCount: imported.totalPlayCount,
                        },
                    ],
                    await playtimes.findForImport(
                        userId,
                        UserPlaytimeSource.STEAM,
                        [Number(imported.gameId)],
                    ),
                );
            });
            expect(
                await historyRepository.countBy({ profileUserId: userId }),
            ).toBe(1);
        });

        it("reports the real estimate on rolling week, month and year summary windows", async () => {
            const userId = randomUUID();
            await withFrozenNow(NOW, async () => {
                await importRows([
                    steam(userId, 505, 1_000 * HOUR_SECONDS, 10 * HOUR_SECONDS),
                ]);
            });
            const summary = new ProfileMetricsSummaryService(
                history,
                {
                    findGameGenresByIds: async () => [],
                    getGamePlatformsMap: async () => new Map(),
                } as any,
                {
                    getActivityCountsSince: async () => ({
                        played: 1,
                        finished: 0,
                        reviewed: 0,
                    }),
                } as any,
            );

            await withFrozenNow(NOW, async () => {
                const week = await summary.generateSummary(userId, Period.WEEK);
                expect(week.current).toEqual({
                    totalPlaytimeSeconds: 5 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 5 * HOUR_SECONDS,
                    totalGames: 1,
                });
                expect(week.previous).toEqual(week.current);
                const month = await summary.generateSummary(
                    userId,
                    Period.MONTH,
                );
                expect(month.current).toEqual({
                    totalPlaytimeSeconds: 10 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 10 * HOUR_SECONDS,
                    totalGames: 1,
                });
                expect(month.previous).toEqual({
                    totalPlaytimeSeconds: 0,
                    estimatedPlaytimeSeconds: 0,
                    totalGames: 0,
                });
                const year = await summary.generateSummary(userId, Period.YEAR);
                expect(year.current).toEqual(month.current);
                expect(year.previous).toEqual(month.previous);
            });
        });

        it("keeps the first estimate while later samples only add positive lifetime increments", async () => {
            const userId = randomUUID();
            const observe = async (totalHours: number, recentHours: number) =>
                importRows([
                    steam(
                        userId,
                        502,
                        totalHours * HOUR_SECONDS,
                        recentHours * HOUR_SECONDS,
                    ),
                ]);

            await withFrozenNow(NOW, () => observe(1_000, 10));
            await withFrozenNow(new Date(NOW.getTime() + DAY_MS), () =>
                observe(1_005, 1),
            );
            const afterGrowth = await read(
                userId,
                new Date(NOW.getTime() - 6 * DAY_MS),
                new Date(NOW.getTime() + DAY_MS),
            );
            expect(afterGrowth).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 15_429 + 5 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 15_429,
                }),
            ]);

            await withFrozenNow(new Date(NOW.getTime() + 2 * DAY_MS), () =>
                observe(900, 3),
            );
            await withFrozenNow(new Date(NOW.getTime() + 3 * DAY_MS), () =>
                observe(905, 4),
            );

            expect(
                await read(
                    userId,
                    new Date(NOW.getTime() - 4 * DAY_MS),
                    new Date(NOW.getTime() + 3 * DAY_MS),
                ),
            ).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 10_286 + 10 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 10_286,
                }),
            ]);
            expect(
                await historyRepository.countBy({ profileUserId: userId }),
            ).toBe(4);
        });

        it("orders equal observation timestamps by id without re-bootstrapping", async () => {
            const userId = randomUUID();
            await withFrozenNow(NOW, async () => {
                await importRows([
                    steam(userId, 503, 1_000 * HOUR_SECONDS, 10 * HOUR_SECONDS),
                ]);
                await importRows([
                    steam(
                        userId,
                        503,
                        1_000 * HOUR_SECONDS + 60,
                        1 * HOUR_SECONDS,
                    ),
                ]);
            });

            const rows = await historyRepository.find({
                where: { profileUserId: userId },
                order: { id: "ASC" },
            });
            expect(rows.map((row) => row.createdAt.getTime())).toEqual([
                NOW.getTime(),
                NOW.getTime(),
            ]);
            expect(
                await read(userId, new Date(NOW.getTime() - 7 * DAY_MS), NOW),
            ).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 60 + 5 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 5 * HOUR_SECONDS,
                }),
            ]);
        });

        it("keeps a first observation's overlap when it happens after the previous window end", async () => {
            const userId = randomUUID();
            const observedAt = new Date("2026-01-11T12:00:00.000Z");
            await historyRepository.insert({
                ...steam(userId, 601, 1_000 * HOUR_SECONDS, 10 * HOUR_SECONDS),
                createdAt: observedAt,
            });

            const previousStart = new Date("2026-01-01T12:00:00.000Z");
            const currentStart = new Date("2026-01-08T12:00:00.000Z");
            const currentEnd = new Date("2026-01-15T12:00:00.000Z");
            const previous = await read(userId, previousStart, currentStart);
            const current = await read(userId, currentStart, currentEnd);

            expect(previous).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 5 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 5 * HOUR_SECONDS,
                }),
            ]);
            expect(current).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 7_714,
                    estimatedPlaytimeSeconds: 7_714,
                }),
            ]);
            expect(
                previous[0].totalPlaytimeInPeriodSeconds +
                    current[0].totalPlaytimeInPeriodSeconds,
            ).toBe(7_714 + 5 * HOUR_SECONDS);
        });

        it("crosses a year boundary with conserved rounding", async () => {
            const userId = randomUUID();
            await historyRepository.insert({
                ...steam(userId, 602, 1_000 * HOUR_SECONDS, 10 * HOUR_SECONDS),
                createdAt: new Date("2026-01-05T00:00:00.000Z"),
            });

            const previous = await read(
                userId,
                new Date("2025-01-01T00:00:00.000Z"),
                new Date("2026-01-01T00:00:00.000Z"),
            );
            const current = await read(
                userId,
                new Date("2026-01-01T00:00:00.000Z"),
                new Date("2027-01-01T00:00:00.000Z"),
            );

            expect(previous).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 25_714,
                    estimatedPlaytimeSeconds: 25_714,
                }),
            ]);
            expect(current).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 10_286,
                    estimatedPlaytimeSeconds: 10_286,
                }),
            ]);
            expect(
                previous[0].totalPlaytimeInPeriodSeconds +
                    current[0].totalPlaytimeInPeriodSeconds,
            ).toBe(10 * HOUR_SECONDS);
        });

        it("handles exact overlap edges and lets the estimate expire with the sliding window", async () => {
            const userId = randomUUID();
            await historyRepository.insert({
                ...steam(userId, 603, 1_000 * HOUR_SECONDS, 2 * HOUR_SECONDS),
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
            });
            const window = (start: string, end: string) =>
                read(userId, new Date(start), new Date(end));

            expect(
                await window(
                    "2025-12-18T00:00:00.000Z",
                    "2026-01-01T00:00:00.000Z",
                ),
            ).toEqual([
                expect.objectContaining({
                    totalPlaytimeInPeriodSeconds: 2 * HOUR_SECONDS,
                    estimatedPlaytimeSeconds: 2 * HOUR_SECONDS,
                }),
            ]);
            expect(
                await window(
                    "2026-01-01T00:00:00.000Z",
                    "2026-01-08T00:00:00.000Z",
                ),
            ).toEqual([]);
            expect(
                await window(
                    "2025-12-04T00:00:00.000Z",
                    "2025-12-18T00:00:00.000Z",
                ),
            ).toEqual([]);
            expect(
                await window(
                    "2026-01-15T00:00:00.000Z",
                    "2026-01-22T00:00:00.000Z",
                ),
            ).toEqual([]);
        });

        it("isolates users, games, platforms and sources and keeps non-Steam or zero-recent starts at zero", async () => {
            const userId = randomUUID();
            const otherUserId = randomUUID();
            await historyRepository.insert([
                {
                    ...steam(
                        userId,
                        701,
                        1_000 * HOUR_SECONDS,
                        10 * HOUR_SECONDS,
                    ),
                    createdAt: NOW,
                },
                {
                    ...steam(userId, 702, 1_000 * HOUR_SECONDS, 0),
                    createdAt: NOW,
                },
                {
                    ...steam(
                        userId,
                        702,
                        1_000 * HOUR_SECONDS,
                        2 * HOUR_SECONDS,
                        PLAYSTATION_PLATFORM_ID,
                    ),
                    createdAt: NOW,
                },
                {
                    ...steam(
                        userId,
                        701,
                        1_000 * HOUR_SECONDS,
                        10 * HOUR_SECONDS,
                    ),
                    source: UserPlaytimeSource.PSN,
                    createdAt: NOW,
                },
                {
                    ...steam(
                        otherUserId,
                        701,
                        1_000 * HOUR_SECONDS,
                        2 * HOUR_SECONDS,
                    ),
                    createdAt: NOW,
                },
            ]);
            const startDate = new Date(NOW.getTime() - 7 * DAY_MS);
            const byIdentity = (rows: Awaited<ReturnType<typeof read>>) =>
                new Map(
                    rows.map((row) => [
                        `${row.source}:${row.gameId}:${row.platformId}`,
                        row,
                    ]),
                );

            const all = await read(userId, startDate, NOW);
            expect(all).toHaveLength(4);
            const identities = byIdentity(all);
            expect(identities.get("steam:701:6")).toMatchObject({
                totalPlaytimeInPeriodSeconds: 5 * HOUR_SECONDS,
                estimatedPlaytimeSeconds: 5 * HOUR_SECONDS,
            });
            expect(identities.get("steam:702:6")).toMatchObject({
                totalPlaytimeInPeriodSeconds: 0,
            });
            expect(
                identities.get("steam:702:6")?.estimatedPlaytimeSeconds,
            ).toBeUndefined();
            expect(identities.get("steam:702:48")).toMatchObject({
                totalPlaytimeInPeriodSeconds: HOUR_SECONDS,
                estimatedPlaytimeSeconds: HOUR_SECONDS,
            });
            expect(identities.get("psn:701:6")).toMatchObject({
                totalPlaytimeInPeriodSeconds: 0,
            });
            expect(
                identities.get("psn:701:6")?.estimatedPlaytimeSeconds,
            ).toBeUndefined();

            expect(
                (
                    await read(
                        userId,
                        startDate,
                        NOW,
                        UserPlaytimeSource.STEAM,
                        PC_PLATFORM_ID,
                    )
                )
                    .map(
                        (row) =>
                            `${row.source}:${row.gameId}:${row.platformId}`,
                    )
                    .sort(),
            ).toEqual(["steam:701:6", "steam:702:6"]);
            expect(
                byIdentity(
                    await read(userId, startDate, NOW, UserPlaytimeSource.XBOX),
                ).size,
            ).toBe(0);
            expect(
                byIdentity(
                    await read(
                        userId,
                        startDate,
                        NOW,
                        UserPlaytimeSource.STEAM,
                        PLAYSTATION_PLATFORM_ID,
                    ),
                ).get("steam:702:48"),
            ).toMatchObject({
                totalPlaytimeInPeriodSeconds: HOUR_SECONDS,
                estimatedPlaytimeSeconds: HOUR_SECONDS,
            });
            expect(
                byIdentity(await read(otherUserId, startDate, NOW)).get(
                    "steam:701:6",
                ),
            ).toMatchObject({
                totalPlaytimeInPeriodSeconds: HOUR_SECONDS,
                estimatedPlaytimeSeconds: HOUR_SECONDS,
            });
        });

        it("keeps the extra first-observation query bounded and indexed on a representative history", async () => {
            const userId = randomUUID();
            const observations = [
                "2026-11-12T00:00:00.000Z",
                "2026-11-13T00:00:00.000Z",
                "2026-11-14T00:00:00.000Z",
            ];
            const rows = Array.from({ length: 1_000 }, (_, index) => {
                const gameId = 9_000 + index;
                return observations.map((createdAt, observation) => ({
                    profileUserId: userId,
                    gameId,
                    platformId: PC_PLATFORM_ID,
                    source: UserPlaytimeSource.STEAM,
                    totalPlaytimeSeconds: 1_000_000 + observation * 100,
                    recentPlaytimeSeconds: observation === 0 ? HOUR_SECONDS : 0,
                    createdAt: new Date(createdAt),
                }));
            }).flat();
            for (let offset = 0; offset < rows.length; offset += 500) {
                await historyRepository.insert(
                    rows.slice(offset, offset + 500),
                );
            }
            await source.query("ANALYZE TABLE user_playtime_history");

            const log = jest.spyOn(source.logger, "logQuery");
            try {
                const startDate = new Date("2026-11-08T12:00:00.000Z");
                const endDate = new Date("2026-11-15T12:00:00.000Z");
                const started = performance.now();
                const totals = await read(userId, startDate, endDate);
                const elapsed = performance.now() - started;
                const queries: [string, unknown[] | undefined][] =
                    log.mock.calls.map(([sql, parameters]) => [
                        String(sql),
                        parameters as unknown[] | undefined,
                    ]);
                const aggregation = queries.find(([sql]) =>
                    sql.includes("SUM(GREATEST"),
                );
                const estimate = queries.find(([sql]) =>
                    sql.includes("NOT EXISTS"),
                );

                expect(totals).toHaveLength(1_000);
                expect(
                    totals.every(
                        (row) =>
                            row.totalPlaytimeInPeriodSeconds === 1_100 &&
                            row.estimatedPlaytimeSeconds === 900,
                    ),
                ).toBe(true);
                expect(
                    queries.filter(([sql]) => sql.startsWith("SELECT")),
                ).toHaveLength(2);
                expect(aggregation).toBeDefined();
                expect(estimate).toBeDefined();

                const plan = (await source.query(
                    `EXPLAIN ${estimate![0]}`,
                    estimate![1],
                )) as any[];
                const byTable = new Map(
                    plan.map((row: any) => [row.table, row]),
                );
                expect(byTable.get("previous").key).toBe(
                    "IDX_playtime_observation_previous",
                );
                expect([
                    "IDX_playtime_history_profile_period",
                    "IDX_playtime_observation_window",
                ]).toContain(byTable.get("ph").key);

                const timeSql = async ([sql, parameters]: [
                    string,
                    unknown[] | undefined,
                ]) => {
                    const queryStarted = performance.now();
                    await source.query(sql, parameters);
                    return (
                        Math.round((performance.now() - queryStarted) * 10) / 10
                    );
                };
                console.log("first Steam observation estimate", {
                    historyRows: rows.length,
                    games: 1_000,
                    totalReadMs: Math.round(elapsed * 10) / 10,
                    aggregationMs: await timeSql(aggregation!),
                    estimateMs: await timeSql(estimate!),
                    plan: plan.map((row: any) => ({
                        table: row.table,
                        type: row.type,
                        key: row.key,
                        rows: row.rows,
                        extra: row.Extra,
                    })),
                });
            } finally {
                log.mockRestore();
            }
        }, 60_000);
    },
);
