import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DataSource } from "typeorm";
import {
    addTransactionalDataSource,
    deleteDataSourceByName,
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { PlaytimeHistoryService } from "./playtime-history.service";
import { PlaytimeService } from "./playtime.service";
import { UserPlaytimeSource } from "./playtime.constants";
import { IndexPlaytimeObservations1792886400003 } from "../migrations/1792886400003-IndexPlaytimeObservations";
import { setCacheManager } from "../utils/cacheable";

const mysqlDescribe = process.env.PLAYER_IMPORT_TEST_MYSQL_PORT
    ? describe
    : describe.skip;

mysqlDescribe("playtime observation transaction on disposable MySQL", () => {
    const database = `player_import_test_${randomUUID().replaceAll("-", "")}`;
    const profileUserId = `playtime-${randomUUID()}`;
    let source: DataSource;
    let admin: DataSource;

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
        for (const table of ["user_playtime", "user_playtime_history"]) {
            await source.query(`CREATE TABLE \`${table}\` (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                source VARCHAR(255) NOT NULL,
                profileUserId VARCHAR(255) NOT NULL,
                gameId BIGINT NOT NULL,
                totalPlaytimeSeconds INT NOT NULL DEFAULT 0,
                recentPlaytimeSeconds INT NOT NULL DEFAULT 0,
                lastPlayedDate DATETIME NULL,
                firstPlayedDate DATETIME NULL,
                totalPlayCount INT NOT NULL DEFAULT 0,
                platformId BIGINT NOT NULL,
                checksum VARCHAR(255) NULL,
                createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
            ) ENGINE=InnoDB`);
        }
    });

    afterAll(async () => {
        deleteDataSourceByName("default");
        if (source?.isInitialized) await source.destroy();
        if (admin?.isInitialized) {
            await admin.query(`DROP DATABASE \`${database}\``);
            await admin.destroy();
        }
    });

    it("rolls back a history insert when the current-row write fails, then retries once", async () => {
        const playtimeRepository = source.getRepository(UserPlaytime);
        const historyRepository = source.getRepository(UserPlaytimeHistory);
        const service = new PlaytimeService(
            playtimeRepository,
            new PlaytimeHistoryService(historyRepository, {} as any),
        );
        jest.spyOn(service, "findOne").mockImplementation(
            (userId, gameId, sourceName, platformId) =>
                playtimeRepository.findOneBy({
                    profileUserId: userId,
                    gameId,
                    source: sourceName,
                    platformId,
                }),
        );
        const save = jest.spyOn(playtimeRepository, "save");
        save.mockImplementationOnce(async () => {
            throw new Error("injected current-row write failure");
        });
        const observation = {
            profileUserId,
            gameId: 1,
            source: UserPlaytimeSource.STEAM,
            platformId: 7,
            totalPlaytimeSeconds: 3600,
            recentPlaytimeSeconds: 120,
            lastPlayedDate: new Date("2026-10-01T10:20:30.000Z"),
            firstPlayedDate: undefined,
            totalPlayCount: undefined,
        };

        await expect(service.save(observation)).rejects.toThrow(
            "injected current-row write failure",
        );
        expect(
            Number(
                (
                    await source.query(
                        "SELECT COUNT(*) AS count FROM user_playtime_history WHERE profileUserId = ?",
                        [profileUserId],
                    )
                )[0].count,
            ),
        ).toBe(0);
        expect(
            Number(
                (
                    await source.query(
                        "SELECT COUNT(*) AS count FROM user_playtime WHERE profileUserId = ?",
                        [profileUserId],
                    )
                )[0].count,
            ),
        ).toBe(0);

        await service.save(observation);
        await service.save(observation);

        expect(
            Number(
                (
                    await source.query(
                        "SELECT COUNT(*) AS count FROM user_playtime_history WHERE profileUserId = ?",
                        [profileUserId],
                    )
                )[0].count,
            ),
        ).toBe(1);
        expect(
            Number(
                (
                    await source.query(
                        "SELECT COUNT(*) AS count FROM user_playtime WHERE profileUserId = ?",
                        [profileUserId],
                    )
                )[0].count,
            ),
        ).toBe(1);
    });

    it.each([
        {
            samples: [
                [-1, 100],
                [1, 160],
            ],
            expected: 60,
        },
        { samples: [[1, 160]], expected: 0 },
        {
            samples: [
                [-1, 100],
                [1, 80],
                [2, 90],
            ],
            expected: 10,
        },
        {
            samples: [
                [-1, 100],
                [0.5, 160],
                [1, 120],
                [2, 150],
            ],
            expected: 90,
        },
        {
            samples: [
                [-1, 100],
                [0, 80],
                [1, 90],
            ],
            expected: 10,
        },
        {
            samples: [
                [-1, 100],
                [1, 160],
                [2, 80],
            ],
            expected: 60,
        },
        // Samples at start form the baseline; samples at end are included in ID order.
        {
            samples: [
                [-1, 50],
                [0, 80],
                [0, 100],
                [1, 160],
                [2, 190],
                [2, 200],
                [3, 300],
            ],
            expected: 100,
        },
    ])(
        "counts endpoint increments for $samples",
        async ({ samples, expected }) => {
            const userId = randomUUID();
            const startDate = new Date("2026-10-25T12:00:00Z");
            const history = new PlaytimeHistoryService(
                source.getRepository(UserPlaytimeHistory),
                {} as any,
            );
            for (const [offset, total] of samples) {
                await history.save(
                    {
                        profileUserId: userId,
                        gameId: 1,
                        source: UserPlaytimeSource.PSN,
                        platformId: 7,
                        totalPlaytimeSeconds: total,
                    } as any,
                    new Date(startDate.getTime() + offset * 1000),
                );
            }
            const totals = await history.getTotalPlaytimeForPeriod({
                userId,
                startDate,
                endDate: new Date(startDate.getTime() + 2000),
            });
            expect(totals).toEqual([
                expect.objectContaining({
                    gameId: 1,
                    totalPlaytimeInPeriodSeconds: expected,
                }),
            ]);
        },
    );

    it("keeps manual ownership, null dates, retries, and source/platform histories separate", async () => {
        const repository = source.getRepository(UserPlaytime);
        const history = new PlaytimeHistoryService(
            source.getRepository(UserPlaytimeHistory),
            {} as any,
        );
        const service = new PlaytimeService(repository, history);
        jest.spyOn(service, "findOne").mockImplementation(
            (profileUserId, gameId, source, platformId) =>
                repository.findOneBy({
                    profileUserId,
                    gameId,
                    source,
                    platformId,
                }),
        );
        const owner = randomUUID();
        const before = new Date(Date.now() - 1000);
        for (const [provider, platformId, total] of [
            [UserPlaytimeSource.STEAM, 6, 100],
            [UserPlaytimeSource.XBOX, 6, 200],
            [UserPlaytimeSource.XBOX, 49, 300],
        ] as const) {
            const dto = {
                profileUserId: "other",
                gameId: 2,
                platformId,
                source: provider,
                totalPlaytimeSeconds: total,
                lastPlayedDate: null,
            };
            await service.submit(owner, dto);
            await service.submit(owner, dto);
            await service.submit(owner, {
                ...dto,
                totalPlaytimeSeconds: total + 10,
            });
        }
        const rows = await repository.findBy({ profileUserId: owner });
        expect(rows).toHaveLength(3);
        expect(rows.every((row) => row.lastPlayedDate === null)).toBe(true);
        expect(await repository.countBy({ profileUserId: "other" })).toBe(0);
        const totals = await history.getTotalPlaytimeForPeriod({
            userId: owner,
            startDate: before,
            endDate: new Date(Date.now() + 1000),
        });
        expect(totals).toHaveLength(3);
        expect(
            totals.every((row) => row.totalPlaytimeInPeriodSeconds === 10),
        ).toBe(true);
        expect(
            await source
                .getRepository(UserPlaytimeHistory)
                .countBy({ profileUserId: owner }),
        ).toBe(6);
    });

    it("uses one SQL period aggregation for a multi-game import after all history inserts", async () => {
        const userId = randomUUID();
        const repository = source.getRepository(UserPlaytime);
        const service = new PlaytimeService(
            repository,
            new PlaytimeHistoryService(
                source.getRepository(UserPlaytimeHistory),
                {} as any,
            ),
        );
        const log = jest.spyOn(source.logger, "logQuery");
        try {
            const rows = [10, 11, 12].map(
                (gameId) =>
                    ({
                        profileUserId: userId,
                        gameId,
                        platformId: 7,
                        source: UserPlaytimeSource.PSN,
                        totalPlaytimeSeconds: 100,
                    }) as any,
            );
            await service.saveImported(
                rows,
                await service.findForImport(
                    userId,
                    UserPlaytimeSource.PSN,
                    rows.map((row) => row.gameId),
                ),
            );
            const queries = log.mock.calls.map(([sql]) => sql);
            expect(
                queries.filter((sql) => sql.includes("SUM(GREATEST")),
            ).toHaveLength(1);
            expect(
                queries.filter(
                    (sql) =>
                        sql.startsWith("SELECT") &&
                        sql.includes("FROM `user_playtime`") &&
                        sql.includes("gameId` IN"),
                ),
            ).toHaveLength(1);
            const historyWrites = queries.map((sql, index) =>
                sql.startsWith("INSERT INTO `user_playtime_history`")
                    ? index
                    : -1,
            );
            expect(Math.max(...historyWrites)).toBeLessThan(
                queries.findIndex((sql) => sql.includes("SUM(GREATEST")),
            );
        } finally {
            log.mockRestore();
        }
    });

    it("measures cold and mostly unchanged warm imports without cached history", async () => {
        const userId = randomUUID();
        const service = new PlaytimeService(
            source.getRepository(UserPlaytime),
            new PlaytimeHistoryService(
                source.getRepository(UserPlaytimeHistory),
                {} as any,
            ),
        );
        const rows = Array.from(
            { length: 1001 },
            (_, index) =>
                ({
                    profileUserId: userId,
                    gameId: index + 100,
                    platformId: 7,
                    source: UserPlaytimeSource.PSN,
                    totalPlaytimeSeconds: 100,
                    totalPlayCount: 7,
                    lastPlayedDate: null,
                }) as any,
        );
        const log = jest.spyOn(source.logger, "logQuery");
        try {
            const cold = await service.saveImported(
                rows,
                await service.findForImport(
                    userId,
                    UserPlaytimeSource.PSN,
                    rows.map((row) => row.gameId),
                ),
            );
            const coldQueries = [...log.mock.calls];
            log.mockClear();
            const warmRows = rows.map((row, index) => ({
                ...row,
                totalPlaytimeSeconds: index < 5 ? 110 : 100,
            }));
            const warm = await service.saveImported(
                warmRows,
                await service.findForImport(
                    userId,
                    UserPlaytimeSource.PSN,
                    rows.map((row) => row.gameId),
                ),
            );
            const warmQueries = [...log.mock.calls];
            const counts = (queries: typeof coldQueries) => ({
                statements: queries.length,
                currentLookups: queries.filter(
                    ([sql]) =>
                        sql.includes("FROM `user_playtime`") &&
                        sql.includes("gameId` IN"),
                ).length,
                historyAggregations: queries.filter(([sql]) =>
                    sql.includes("SUM(GREATEST"),
                ).length,
                historyInserts: queries.filter(([sql]) =>
                    sql.startsWith("INSERT INTO `user_playtime_history`"),
                ).length,
                currentWrites: queries.filter(([sql]) =>
                    /^(INSERT INTO|UPDATE) `user_playtime`/.test(sql),
                ).length,
            });
            expect(counts(coldQueries)).toMatchObject({
                currentLookups: 3,
                historyAggregations: 1,
                historyInserts: 1001,
                currentWrites: 1001,
            });
            expect(counts(warmQueries)).toMatchObject({
                currentLookups: 3,
                historyAggregations: 1,
                historyInserts: 5,
                currentWrites: 5,
            });
            expect(
                cold.every(
                    (row) =>
                        row.totalPlaytimeSeconds === 100 &&
                        row.recentPlaytimeSeconds === 0,
                ),
            ).toBe(true);
            expect(
                warm.every(
                    (row, index) =>
                        row.totalPlaytimeSeconds === (index < 5 ? 110 : 100) &&
                        row.recentPlaytimeSeconds === (index < 5 ? 10 : 0) &&
                        row.totalPlayCount === 7,
                ),
            ).toBe(true);
            const [sql, parameters] = warmQueries.find(([sql]) =>
                sql.includes("SUM(GREATEST"),
            )!;
            const historyRepo = source.getRepository(UserPlaytimeHistory);
            for (let offset = 0; offset < 5000; offset += 500) {
                await historyRepo.insert(
                    Array.from({ length: 500 }, (_, index) => ({
                        profileUserId: "unrelated",
                        gameId: offset + index + 1,
                        platformId: 7,
                        source: UserPlaytimeSource.PSN,
                        totalPlaytimeSeconds: 500,
                    })),
                );
            }
            for (let offset = 0; offset < 5000; offset += 500) {
                await historyRepo.insert(
                    Array.from({ length: 500 }, (_, index) => ({
                        profileUserId: userId,
                        gameId: 100 + ((offset + index) % 1001),
                        platformId: 7,
                        source: UserPlaytimeSource.PSN,
                        totalPlaytimeSeconds: 50,
                        createdAt: new Date("2020-01-01T00:00:00Z"),
                    })),
                );
            }
            const beforePlan = await source.query(`EXPLAIN ${sql}`, parameters);
            const migration = new IndexPlaytimeObservations1792886400003();
            const runner = source.createQueryRunner();
            let plan: any[];
            try {
                await migration.up(runner);
                await source.query("ANALYZE TABLE user_playtime_history");
                plan = await source.query(`EXPLAIN ${sql}`, parameters);
                expect(plan.find((row) => row.table === "previous").key).toBe(
                    "IDX_playtime_observation_previous",
                );
                expect(plan.find((row) => row.table === "ph").key).toBe(
                    "IDX_playtime_observation_window",
                );
                await migration.down(runner);
                expect(
                    await source
                        .getRepository(UserPlaytimeHistory)
                        .countBy({ profileUserId: userId }),
                ).toBe(6006);
                await migration.up(runner);
            } finally {
                await runner.release();
            }
            console.log("playtime fixture measurements", {
                size: rows.length,
                cold: counts(coldQueries),
                warm: counts(warmQueries),
                beforePlan: beforePlan.map((row: any) => ({
                    table: row.table,
                    key: row.key,
                })),
                plan: plan!.map((row: any) => ({
                    table: row.table,
                    type: row.type,
                    key: row.key,
                    rows: row.rows,
                })),
            });
        } finally {
            log.mockRestore();
        }
    }, 60000);
    it("expires real PSN/Xbox observation increments after 14 days while retaining Steam recent semantics", async () => {
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
            for (const provider of [
                UserPlaytimeSource.PSN,
                UserPlaytimeSource.XBOX,
                UserPlaytimeSource.STEAM,
            ]) {
                const userId = randomUUID();
                const service = new PlaytimeService(
                    source.getRepository(UserPlaytime),
                    new PlaytimeHistoryService(
                        source.getRepository(UserPlaytimeHistory),
                        {} as any,
                    ),
                );
                const observe = async (total: number) => {
                    const rows = await service.saveImported(
                        [
                            {
                                profileUserId: userId,
                                gameId: 88,
                                platformId: 7,
                                source: provider,
                                totalPlaytimeSeconds: total,
                                recentPlaytimeSeconds:
                                    provider === UserPlaytimeSource.STEAM
                                        ? 60
                                        : undefined,
                                firstPlayedDate: null,
                                lastPlayedDate: null,
                                totalPlayCount: 3,
                            },
                        ],
                        await service.findForImport(userId, provider, [88]),
                    );
                    return rows[0];
                };
                jest.setSystemTime(new Date("2026-10-01T12:00:00Z"));
                await observe(100);
                jest.setSystemTime(new Date("2026-10-02T12:00:00Z"));
                expect((await observe(160)).recentPlaytimeSeconds).toBe(60);
                jest.setSystemTime(new Date("2026-10-17T12:00:00Z"));
                expect((await observe(160)).recentPlaytimeSeconds).toBe(
                    provider === UserPlaytimeSource.STEAM ? 60 : 0,
                );
                expect(
                    await source
                        .getRepository(UserPlaytimeHistory)
                        .countBy({ profileUserId: userId }),
                ).toBe(2);
            }
        } finally {
            jest.useRealTimers();
        }
    });

    it("a history-write rejection leaves no current row and retries once", async () => {
        const userId = randomUUID();
        const historyRepo = source.getRepository(UserPlaytimeHistory);
        const service = new PlaytimeService(
            source.getRepository(UserPlaytime),
            new PlaytimeHistoryService(historyRepo, {} as any),
        );
        const failure = jest
            .spyOn(historyRepo, "insert")
            .mockRejectedValueOnce(new Error("injected history failure"));
        const dto = {
            profileUserId: userId,
            gameId: 99,
            platformId: 7,
            source: UserPlaytimeSource.PSN,
            totalPlaytimeSeconds: 100,
            totalPlayCount: 0,
            recentPlaytimeSeconds: undefined,
            firstPlayedDate: null,
            lastPlayedDate: null,
        };
        await expect(service.saveImported([dto], new Map())).rejects.toThrow(
            "history failure",
        );
        expect(
            await source
                .getRepository(UserPlaytime)
                .countBy({ profileUserId: userId }),
        ).toBe(0);
        expect(await historyRepo.countBy({ profileUserId: userId })).toBe(0);
        failure.mockRestore();
        await service.saveImported([dto], new Map());
        expect(await historyRepo.countBy({ profileUserId: userId })).toBe(1);
    });
});
