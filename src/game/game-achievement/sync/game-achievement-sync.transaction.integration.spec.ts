import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { EGameExternalGameCategory } from "../../game-repository/game-repository.constants";
import { GameAchievementSyncProcessor } from "./game-achievement-sync.processor";
import { GameAchievementActivityService } from "../game-achievement-activity.service";
import {
    GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME,
    GAME_ACHIEVEMENT_STEAM_JOB_NAME,
} from "./game-achievement-sync.constants";
import {
    playerOwner,
    playerStateFixture,
} from "../../../sync/player-data/player-sync.fixture";

const mysqlDescribe = process.env.PLAYER_IMPORT_TEST_MYSQL_PORT
    ? describe
    : describe.skip;

mysqlDescribe("achievement commit transactions on disposable MySQL", () => {
    const database = `player_achievement_tx_${randomUUID().replaceAll("-", "")}`;
    const options = {
        type: "mysql" as const,
        host: "127.0.0.1",
        port: Number(process.env.PLAYER_IMPORT_TEST_MYSQL_PORT),
        username: "root",
        password: "",
        timezone: "Z",
        connectTimeout: 5000,
    };
    let source: DataSource;
    let admin: DataSource;

    beforeAll(async () => {
        admin = await new DataSource(options).initialize();
        await admin.query(`CREATE DATABASE \`${database}\``);
        source = await new DataSource({
            ...options,
            database,
            entities: [],
        }).initialize();
        await source.query(`CREATE TABLE achievement_sync_write (
            id INT AUTO_INCREMENT PRIMARY KEY,
            writeName VARCHAR(32) NOT NULL,
            totalObtained INT NULL,
            hasCompletedAll TINYINT NULL,
            hasPlatinum TINYINT NULL,
            pendingDelivery TINYINT NULL
        ) ENGINE=InnoDB`);
        await source.query(`CREATE TABLE achievement_sync_obtained (
            profileUserId VARCHAR(36) NOT NULL,
            externalGameId BIGINT NOT NULL,
            externalAchievementId VARCHAR(64) NOT NULL,
            PRIMARY KEY (profileUserId, externalGameId, externalAchievementId)
        ) ENGINE=InnoDB`);
    });

    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
        if (admin?.isInitialized) {
            await admin.query(`DROP DATABASE \`${database}\``);
            await admin.destroy();
        }
    });

    beforeEach(async () => {
        jest.restoreAllMocks();
        await source.query("DELETE FROM achievement_sync_write");
        await source.query("DELETE FROM achievement_sync_obtained");
    });

    it("commits all local writes and publishes activity after commit", async () => {
        const events: string[] = [];
        const processor = makeProcessor(source, events);

        await processor.process(job() as any);

        expect(
            (
                await source.query(
                    "SELECT writeName FROM achievement_sync_write ORDER BY id",
                )
            ).map((row: { writeName: string }) => row.writeName),
        ).toEqual([
            "obtained rows",
            "completion status",
            "activity",
            "game state",
        ]);
        expect(events).toEqual([
            "obtained snapshot",
            "catalogue snapshot",
            "transaction:start",
            "obtained rows",
            "completion status",
            "activity",
            "game state",
            "transaction:commit",
            "publish",
        ]);
        expect(
            await source.query(
                "SELECT pendingDelivery FROM achievement_sync_write WHERE writeName = 'activity'",
            ),
        ).toEqual([{ pendingDelivery: 1 }]);
    });

    it("keeps committed achievements and a pending marker when queue publication fails", async () => {
        const events: string[] = [];
        const processor = makeProcessor(source, events, undefined, {}, true);

        await expect(processor.process(job() as any)).resolves.toBe("complete");

        expect(
            await source.query("SELECT * FROM achievement_sync_obtained"),
        ).toHaveLength(1);
        expect(
            await source.query(
                "SELECT pendingDelivery FROM achievement_sync_write WHERE writeName = 'activity'",
            ),
        ).toEqual([{ pendingDelivery: 1 }]);
        expect(events.indexOf("transaction:commit")).toBeLessThan(
            events.indexOf("publish"),
        );
    });

    it("recovers a committed pending activity without refetching provider snapshots", async () => {
        const events: string[] = [];
        const processor = makeProcessor(source, events, undefined, {}, true);

        await processor.process(job() as any);
        const providerReadCount = events.filter((event) =>
            event.endsWith("snapshot"),
        ).length;
        const repository = {
            find: jest.fn(async ({ take }) => {
                const rows = await source.query(
                    "SELECT id, pendingDelivery FROM achievement_sync_write WHERE writeName = 'activity' AND pendingDelivery = 1 ORDER BY id LIMIT ?",
                    [take],
                );
                return rows.map((row: any) => ({
                    ...row,
                    profileUserId: "user",
                }));
            }),
            update: jest.fn(async (id, activity) =>
                source.query(
                    "UPDATE achievement_sync_write SET pendingDelivery = ? WHERE id = ?",
                    [activity.pendingDelivery ? 1 : 0, id],
                ),
            ),
        };
        const register = jest.fn(async () => undefined);
        const activityService = new GameAchievementActivityService(
            repository as any,
            {} as any,
            { register } as any,
        );

        await activityService.retryPendingDeliveries();

        expect(repository.find).toHaveBeenCalledWith({
            where: { pendingDelivery: true },
            order: { id: "ASC" },
            take: 100,
        });
        expect(register).toHaveBeenCalledTimes(1);
        expect(
            await source.query(
                "SELECT id FROM achievement_sync_write WHERE writeName = 'activity' AND pendingDelivery = 1",
            ),
        ).toEqual([]);
        expect(
            events.filter((event) => event.endsWith("snapshot")),
        ).toHaveLength(providerReadCount);
    });

    it("serializes overlapping imports into one achievement set and one activity", async () => {
        const events: string[] = [];
        const first = makeProcessor(source, events);
        const second = makeProcessor(source, events);

        await Promise.all([
            first.process(job() as any),
            second.process(job() as any),
        ]);

        expect(
            await source.query("SELECT * FROM achievement_sync_obtained"),
        ).toHaveLength(1);
        expect(
            await source.query(
                "SELECT id FROM achievement_sync_write WHERE writeName = 'activity'",
            ),
        ).toHaveLength(1);
        const firstCommit = events.indexOf("transaction:commit");
        const secondStart = events.lastIndexOf("transaction:start");
        expect(firstCommit).toBeGreaterThan(-1);
        expect(secondStart).toBeGreaterThan(firstCommit);
    });

    it("allows a successful retry after the first commit rolls back", async () => {
        const events: string[] = [];
        const first = makeProcessor(source, events, "completion status");
        const retry = makeProcessor(source, events);

        await expect(first.process(job() as any)).rejects.toThrow(
            "failed completion status",
        );
        await retry.process(job() as any);

        expect(
            await source.query("SELECT * FROM achievement_sync_obtained"),
        ).toHaveLength(1);
        expect(
            await source.query(
                "SELECT id FROM achievement_sync_write WHERE writeName = 'activity'",
            ),
        ).toHaveLength(1);
    });

    it("treats zero results as successful state without achievement writes or activity", async () => {
        const processor = makeProcessor(source, [], undefined, {
            obtained: [],
            catalogue: [],
        });

        await expect(processor.process(job() as any)).resolves.toBe("empty");
        expect(
            await source.query("SELECT * FROM achievement_sync_obtained"),
        ).toEqual([]);
        expect(
            (
                await source.query(
                    "SELECT writeName FROM achievement_sync_write ORDER BY id",
                )
            ).map((row: { writeName: string }) => row.writeName),
        ).toEqual(["game state"]);
    });

    it("does not create a second activity for already persisted achievements", async () => {
        await source.query(
            "INSERT INTO achievement_sync_obtained VALUES ('user', 1, 'achievement-1')",
        );
        const processor = makeProcessor(source, []);

        await processor.process(job() as any);

        expect(
            await source.query("SELECT * FROM achievement_sync_obtained"),
        ).toHaveLength(1);
        expect(
            await source.query(
                "SELECT id FROM achievement_sync_write WHERE writeName = 'activity'",
            ),
        ).toEqual([]);
    });

    it("persists new rows with no catalogue but skips completion and activity", async () => {
        const processor = makeProcessor(source, [], undefined, {
            catalogue: [],
        });

        await processor.process(job() as any);

        expect(
            await source.query("SELECT * FROM achievement_sync_obtained"),
        ).toHaveLength(1);
        expect(
            (
                await source.query(
                    "SELECT writeName FROM achievement_sync_write ORDER BY id",
                )
            ).map((row: { writeName: string }) => row.writeName),
        ).toEqual(["obtained rows", "game state"]);
    });

    it("records only newly obtained rows when the complete catalogue changes", async () => {
        await source.query(
            "INSERT INTO achievement_sync_obtained VALUES ('user', 1, 'achievement-1')",
        );
        const processor = makeProcessor(source, [], undefined, {
            obtained: [obtained("achievement-1"), obtained("achievement-2")],
            catalogue: [
                { externalId: "achievement-1" },
                { externalId: "achievement-2" },
            ],
        });

        await processor.process(job() as any);

        expect(
            (
                await source.query(
                    "SELECT externalAchievementId FROM achievement_sync_obtained ORDER BY externalAchievementId",
                )
            ).map(
                (row: { externalAchievementId: string }) =>
                    row.externalAchievementId,
            ),
        ).toEqual(["achievement-1", "achievement-2"]);
        expect(
            await source.query(
                "SELECT totalObtained FROM achievement_sync_write WHERE writeName = 'activity'",
            ),
        ).toEqual([{ totalObtained: 1 }]);
    });

    it("imports multiple PSN sets into one activity", async () => {
        const processor = makeProcessor(source, [], undefined, {
            obtained: [
                obtained(
                    "comm-a_1",
                    EGameExternalGameCategory.PlaystationStoreUs,
                ),
                obtained(
                    "comm-b_1",
                    EGameExternalGameCategory.PlaystationStoreUs,
                ),
            ],
            catalogue: [
                {
                    externalId: "comm-a_1",
                    psnDetails: { trophyType: "bronze" },
                },
                {
                    externalId: "comm-b_1",
                    psnDetails: { trophyType: "platinum" },
                },
            ],
        });

        await processor.process(
            job(GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME) as any,
        );

        expect(
            await source.query("SELECT * FROM achievement_sync_obtained"),
        ).toHaveLength(2);
        expect(
            await source.query(
                "SELECT totalObtained, hasCompletedAll, hasPlatinum FROM achievement_sync_write WHERE writeName = 'activity'",
            ),
        ).toEqual([{ totalObtained: 2, hasCompletedAll: 1, hasPlatinum: 1 }]);
    });

    it.each(["obtained rows", "completion status", "activity", "game state"])(
        "rolls back every local write when %s fails",
        async (failedWrite) => {
            const events: string[] = [];
            const processor = makeProcessor(source, events, failedWrite);

            await expect(processor.process(job() as any)).rejects.toThrow(
                `failed ${failedWrite}`,
            );

            expect(
                await source.query("SELECT id FROM achievement_sync_write"),
            ).toEqual([]);
            expect(
                await source.query("SELECT * FROM achievement_sync_obtained"),
            ).toEqual([]);
            expect(events).not.toContain("transaction:commit");
            expect(events).not.toContain("publish");
            expect(events.indexOf("obtained snapshot")).toBeLessThan(
                events.indexOf("transaction:start"),
            );
            expect(events.indexOf("catalogue snapshot")).toBeLessThan(
                events.indexOf("transaction:start"),
            );
        },
    );

    function makeProcessor(
        dataSource: DataSource,
        events: string[],
        failedWrite?: string,
        fixture: {
            obtained?: any[];
            catalogue?: any[];
        } = {},
        failPublish = false,
    ) {
        if (!jest.isMockFunction(dataSource.createQueryRunner)) {
            const createQueryRunner =
                dataSource.createQueryRunner.bind(dataSource);
            jest.spyOn(dataSource, "createQueryRunner").mockImplementation(
                () => {
                    const runner = createQueryRunner();
                    const startTransaction =
                        runner.startTransaction.bind(runner);
                    const commitTransaction =
                        runner.commitTransaction.bind(runner);
                    runner.startTransaction = async () => {
                        events.push("transaction:start");
                        return startTransaction();
                    };
                    runner.commitTransaction = async () => {
                        const result = await commitTransaction();
                        events.push("transaction:commit");
                        return result;
                    };
                    return runner;
                },
            );
        }
        const managerWrite = (name: string, manager: any, activity?: any) =>
            manager.query(
                "INSERT INTO achievement_sync_write (writeName, totalObtained, hasCompletedAll, hasPlatinum, pendingDelivery) VALUES (?, ?, ?, ?, ?)",
                [
                    name,
                    activity?.totalObtained ?? null,
                    activity?.hasCompletedAllAchievements ?? null,
                    activity?.hasObtainedPlatinumTrophy ?? null,
                    activity?.pendingDelivery ?? null,
                ],
            );
        const maybeFail = (name: string) => {
            if (failedWrite === name) throw new Error(`failed ${name}`);
        };
        const state = playerStateFixture();
        state.completeGame.mockImplementation(
            async (_owner, _outcome, _fingerprint, manager) => {
                events.push("game state");
                await managerWrite("game state", manager);
                maybeFail("game state");
            },
        );
        return new GameAchievementSyncProcessor(
            {
                findAllByExternalGameIdForSync: jest.fn(async () => {
                    events.push("catalogue snapshot");
                    return (
                        fixture.catalogue ?? [{ externalId: "achievement-1" }]
                    );
                }),
            } as any,
            {
                fetchObtainedByExternalGameId: jest.fn(async () => {
                    events.push("obtained snapshot");
                    return fixture.obtained ?? [obtained("achievement-1")];
                }),
                persistObtainedAchievements: jest.fn(
                    async (userId, snapshot, manager) => {
                        const existingRows = await manager.query(
                            "SELECT externalAchievementId FROM achievement_sync_obtained WHERE profileUserId = ? AND externalGameId = ?",
                            [userId, 1],
                        );
                        const existing = new Set(
                            existingRows.map(
                                (row: { externalAchievementId: string }) =>
                                    row.externalAchievementId,
                            ),
                        );
                        const newAchievements = snapshot.filter(
                            (achievement: { externalId: string }) =>
                                !existing.has(achievement.externalId),
                        );
                        for (const achievement of newAchievements)
                            await manager.query(
                                "INSERT INTO achievement_sync_obtained (profileUserId, externalGameId, externalAchievementId) VALUES (?, ?, ?)",
                                [userId, 1, achievement.externalId],
                            );
                        if (newAchievements.length === 0) return [];
                        events.push("obtained rows");
                        await managerWrite("obtained rows", manager);
                        maybeFail("obtained rows");
                        return newAchievements.map(
                            (achievement: { externalId: string }) => ({
                                externalAchievementId: achievement.externalId,
                            }),
                        );
                    },
                ),
            } as any,
            {
                save: jest.fn(async (activity, manager) => {
                    events.push("activity");
                    const pendingActivity = {
                        ...activity,
                        pendingDelivery: true,
                    };
                    await managerWrite("activity", manager, pendingActivity);
                    maybeFail("activity");
                    return {
                        id: 1,
                        profileUserId: "user",
                        ...pendingActivity,
                    };
                }),
                publish: jest.fn(async () => {
                    events.push("publish");
                    if (failPublish) throw new Error("queue unavailable");
                }),
            } as any,
            {
                updateGameCompletionStatus: jest.fn(
                    async (_userId, _gameId, catalogue, _obtained, manager) => {
                        if (catalogue.length === 0) return;
                        events.push("completion status");
                        await managerWrite("completion status", manager);
                        maybeFail("completion status");
                    },
                ),
            } as any,
            state as any,
            dataSource,
        );
    }

    function obtained(
        externalId: string,
        source = EGameExternalGameCategory.Steam,
    ) {
        return {
            externalGameId: 1,
            gameId: 1,
            externalId,
            source,
            isObtained: true,
            obtainedAt: new Date("2026-10-01T00:00:00Z"),
        };
    }

    function job(name = GAME_ACHIEVEMENT_STEAM_JOB_NAME) {
        return {
            name,
            data: {
                userId: "user",
                externalGameId: 1,
                owner: playerOwner(
                    "user",
                    name === GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME
                        ? "psn"
                        : "steam",
                    1,
                ),
            },
        };
    }
});
