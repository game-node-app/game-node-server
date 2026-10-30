import { createBaselineTables } from "../../../test/baseline-schema";
import { ConnectionProviderRegistry } from "../../connection/connection-provider.registry";
import { EConnectionAuthMode } from "../../connection/connections.constants";
import { UserPlaytime } from "../../playtime/entity/user-playtime.entity";
import { UserPlaytimeHistory } from "../../playtime/entity/user-playtime-history.entity";
import { PlaytimeService } from "../../playtime/playtime.service";
import { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
import { ProviderSyncError } from "../provider-sync.error";
import { ConnectionsService } from "../../connection/connections.service";
import { UserConnection } from "../../connection/entity/user-connection.entity";
import { PlaytimeWatchService } from "../../playtime/watch/playtime-watch.service";
import { Worker } from "bullmq";
import { PlayerDataQueueService } from "./player-data-queue.service";
import { PlayerDataProcessor } from "./player-data.processor";
import { PLAYER_DATA_QUEUE } from "./player-data.constants";
import {
    playerSyncWrite,
    currentPlayerSyncOwner,
} from "../player-sync-attempt";
import { EConnectionType } from "../../connection/connections.constants";
import {
    initializeTransactionalContext,
    StorageDriver,
    addTransactionalDataSource,
    deleteDataSourceByName,
} from "typeorm-transactional";
import { Queue } from "bullmq";
import {
    PlayerSyncStateService,
    PlayerSyncOwnershipLost,
    PLAYER_OWNER_LEASE_MS,
} from "./player-sync-state.service";
import { PlayerGameSync } from "./entity/player-game-sync.entity";
import { GameAchievementSyncQueueService } from "../../game/game-achievement/sync/game-achievement-sync-queue.service";
import { PLAYER_RECONCILE_INTERVAL_MS } from "./player-sync-policy";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { resolve } from "node:path";
import { PlayerConnectionSync } from "./entity/player-connection-sync.entity";

const mysqlDescribe = process.env.PLAYER_IMPORT_TEST_MYSQL_PORT
    ? describe
    : describe.skip;
mysqlDescribe("player synchronization state on disposable MySQL", () => {
    const database = `player_import_test_${randomUUID().replaceAll("-", "")}`;
    let source: DataSource;
    let admin: DataSource;
    const now = new Date("2026-10-25T00:00:00Z");
    const stages = {
        playtime: {
            outcome: "unknown",
            lastSucceededAt: null,
            nextEligibleAt: now.toISOString(),
        },
        discovery: {
            outcome: "unknown",
            lastSucceededAt: null,
            nextEligibleAt: now.toISOString(),
        },
    };
    beforeAll(async () => {
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
            entities: [resolve(__dirname, "../..", "**/*.entity.ts")],
        }).initialize();
        addTransactionalDataSource(source);
        await createBaselineTables(source, [
            "user_connection",
            "user_connection_credential",
            "player_connection_sync",
            "player_game_sync",
            "user_playtime",
            "user_playtime_history",
        ]);
        // Fixtures insert minimal connection rows; this suite does not exercise those constraints.
        await source.query(
            "ALTER TABLE user_connection ALTER type SET DEFAULT 'steam', ALTER profileUserId SET DEFAULT 'fixture', ALTER sourceUsername SET DEFAULT '', DROP INDEX IDX_dcf89a993cff5c9c49d6dc070b",
        );
    });
    afterAll(async () => {
        deleteDataSourceByName("default");
        if (source?.isInitialized) await source.destroy();
        if (admin?.isInitialized) {
            await admin.query(`DROP DATABASE \`${database}\``);
            await admin.destroy();
        }
    });

    it("persists connection sync state", async () => {
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId) VALUES (1, 'account')",
        );
        await source.getRepository(PlayerConnectionSync).save({
            connectionId: 1,
            sourceUserId: "account",
            nextEligibleAt: now,
            stages,
        } as any);
        expect(
            await source
                .getRepository(PlayerConnectionSync)
                .findOneByOrFail({ connectionId: 1 }),
        ).toMatchObject({
            sourceUserId: "account",
            lastSucceededAt: null,
            ownerToken: null,
            stages,
        });
        await source.getRepository(PlayerConnectionSync).clear();
    });

    it("uses bounded indexed due queries without reading libraries", async () => {
        for (let start = 2; start <= 5001; start += 500) {
            const ids = Array.from(
                { length: Math.min(500, 5002 - start) },
                (_, i) => start + i,
            );
            await source.query(
                `INSERT INTO user_connection (id, sourceUserId) VALUES ${ids.map(() => "(?, 'account')").join(",")}`,
                ids,
            );
            await source.getRepository(PlayerConnectionSync).insert(
                ids.map((connectionId) => ({
                    connectionId,
                    sourceUserId: "account",
                    nextEligibleAt:
                        connectionId < 12
                            ? now
                            : new Date(now.getTime() + 86400000),
                    stages,
                })) as any,
            );
        }
        const service = new PlayerSyncStateService(source);
        jest.spyOn(service as any, "now").mockResolvedValue(now);
        const log = jest.spyOn(source.logger, "logQuery");
        const due = await service.due();
        const [sql, parameters] = log.mock.calls.find(([sql]) =>
            sql.includes("FROM `player_connection_sync`"),
        )!;
        log.mockRestore();
        const plan = await source.query(`EXPLAIN ${sql}`, parameters);
        expect(plan[0].key).toBe("IDX_player_connection_due");
        expect(due.map((row) => row.connectionId)).toEqual(
            Array.from({ length: 10 }, (_, i) => i + 2),
        );
    });
    it("persists a successful empty game independently of obtained rows and rolls back only game state", async () => {
        await source.query(
            "CREATE TABLE game_external_game (id BIGINT PRIMARY KEY, category INT NOT NULL DEFAULT 1)",
        );
        await source.query("INSERT INTO game_external_game (id) VALUES (1)");
        await source.query(
            "CREATE TABLE obtained_game_achievement (id INT PRIMARY KEY, externalGameId BIGINT NOT NULL)",
        );
        await source.query(
            "INSERT INTO obtained_game_achievement VALUES (42, 2)",
        );
        {
            const repo = source.getRepository(PlayerGameSync);
            await repo.save({
                connectionId: 1,
                externalGameId: 1,
                sourceUserId: "account",
                checkedAt: now,
                outcome: "empty",
                nextEligibleAt: new Date(now.getTime() + 86400000),
                reconcileAt: new Date(now.getTime() + 7 * 86400000),
            });
            expect(
                await repo.findOneByOrFail({
                    connectionId: 1,
                    externalGameId: 1,
                }),
            ).toMatchObject({
                outcome: "empty",
                checkedAt: now,
                activityFingerprint: null,
            });
            expect(
                await source.query(
                    "SELECT * FROM obtained_game_achievement WHERE externalGameId = 1",
                ),
            ).toEqual([]);
            expect(
                await source.query("SELECT * FROM obtained_game_achievement"),
            ).toEqual([{ id: 42, externalGameId: "2" }]);
            await repo.clear();
        }
    });
    it("does not enqueue unchanged recent games but reconciles inactive games when due", async () => {
        const connectionId = 6600;
        const externalGameId = 3;
        const userId = "achievement-selection";
        const fingerprint = "same-activity";
        const frozen = new Date("2026-10-25T00:00:00Z");
        const checkedAt = new Date(frozen.getTime() - 2 * 86400000);
        const state = new PlayerSyncStateService(source);
        jest.spyOn(state as any, "now").mockImplementation(
            async () => new Date(frozen),
        );
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId, profileUserId, type) VALUES (?, 'account', ?, 'steam')",
            [connectionId, userId],
        );
        await source.query("INSERT INTO game_external_game (id) VALUES (?)", [
            externalGameId,
        ]);
        await source.getRepository(PlayerGameSync).save({
            connectionId,
            externalGameId,
            sourceUserId: "account",
            checkedAt,
            outcome: "complete",
            activityFingerprint: fingerprint,
            nextEligibleAt: frozen,
            reconcileAt: new Date(
                checkedAt.getTime() + PLAYER_RECONCILE_INTERVAL_MS,
            ),
        });
        const queue = {
            add: jest.fn().mockResolvedValue({ id: "job" }),
            getJob: jest.fn().mockResolvedValue(null),
        };
        const service = new GameAchievementSyncQueueService(
            queue as any,
            state,
        );

        await service.addUserSyncJob(
            userId,
            externalGameId,
            EConnectionType.STEAM,
            fingerprint,
        );
        expect(queue.add).not.toHaveBeenCalled();

        frozen.setTime(checkedAt.getTime() + PLAYER_RECONCILE_INTERVAL_MS);
        await Promise.all([
            service.addUserSyncJob(
                userId,
                externalGameId,
                EConnectionType.STEAM,
                fingerprint,
            ),
            service.addUserSyncJob(
                userId,
                externalGameId,
                EConnectionType.STEAM,
                fingerprint,
            ),
        ]);
        expect(queue.add).toHaveBeenCalledTimes(1);
        expect(queue.add.mock.calls[0][1]).toMatchObject({
            activityFingerprint: fingerprint,
            owner: { reason: "reconciliation" },
        });

        await source.query("INSERT INTO game_external_game (id) VALUES (4)");
        await service.addUserSyncJob(
            userId,
            4,
            EConnectionType.STEAM,
            fingerprint,
        );
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId, profileUserId, type) VALUES (6601, 'psn-account', ?, 'psn')",
            [userId],
        );
        await source.query(
            "INSERT INTO game_external_game (id, category) VALUES (5, 36)",
        );
        await service.addUserSyncJob(
            userId,
            5,
            EConnectionType.PSN,
            fingerprint,
        );
        expect(queue.add).toHaveBeenCalledTimes(3);
        expect(
            queue.add.mock.calls.map(([, data]) => [
                data.externalGameId,
                data.owner.connectionId,
                data.owner.source,
            ]),
        ).toEqual([
            [externalGameId, connectionId, EConnectionType.STEAM],
            [4, connectionId, EConnectionType.STEAM],
            [5, 6601, EConnectionType.PSN],
        ]);
    });
    it("exposes unknown versus successful-empty owner status without credentials and rejects source mismatches", async () => {
        const state = new PlayerSyncStateService(source);
        jest.spyOn(state as any, "now").mockResolvedValue(now);
        const userId = "status-owner";
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId, profileUserId, type) VALUES (6650, 'status-account', ?, 'steam')",
            [userId],
        );
        const unknown = await state.gameStatus(
            userId,
            EConnectionType.STEAM,
            1,
        );
        expect(unknown).toMatchObject({
            status: "unknown",
            outcome: "unknown",
            pending: false,
        });
        const owner = await state.claim(6650, "status-account", 1);
        expect(
            await state.gameStatus(userId, EConnectionType.STEAM, 1),
        ).toMatchObject({ status: "pending", pending: true });
        await state.completeGame(owner!, "empty", "same");
        const complete = await state.gameStatus(
            userId,
            EConnectionType.STEAM,
            1,
        );
        expect(complete).toMatchObject({
            status: "cooldown",
            outcome: "empty",
            pending: false,
            lastSucceededAt: now,
        });
        expect(JSON.stringify(complete)).not.toMatch(
            /status-account|ownerToken|sourceUserId/,
        );
        expect(
            await state.gameStatus("other", EConnectionType.STEAM, 1),
        ).toMatchObject({ status: "disconnected" });
        await expect(state.claim(6650, "status-account", 5)).rejects.toThrow(
            "requested source",
        );
        await expect(
            state.gameStatus(userId, "invalid" as EConnectionType, 1),
        ).rejects.toThrow("Unsupported player source");
    });

    it("admits one competing owner and rejects stale completion after recovery", async () => {
        const first = new PlayerSyncStateService(source);
        const second = new PlayerSyncStateService(source);
        await first.initialize(1, "account", new Date(0));
        const owners = await Promise.all([
            first.claim(1, "account"),
            second.claim(1, "account"),
        ]);
        expect(owners.filter(Boolean)).toHaveLength(1);
        const previous = owners.find(Boolean)!;
        await first.start(previous);
        await source.query(
            "UPDATE player_connection_sync SET leaseExpiresAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE connectionId = 1",
        );
        const current = await second.claim(1, "account");
        expect(current).toBeTruthy();
        expect(current!.ownerToken).not.toBe(previous.ownerToken);
        await second.start(current!);
        await expect(
            first.completeStage(previous, "playtime", "empty"),
        ).rejects.toBeInstanceOf(PlayerSyncOwnershipLost);
        await second.completeStage(current!, "playtime", "empty");
        await second.completeStage(current!, "discovery", "empty");
        await second.finish(current!);
        const state = await source
            .getRepository(PlayerConnectionSync)
            .findOneByOrFail({ connectionId: 1 });
        expect(state.outcome).toBe("empty");
        expect(state.lastSucceededAt).toBeInstanceOf(Date);
        expect(state.ownerToken).toBeNull();
        expect(await first.claim(1, "account")).toBeNull();
    });

    it("renews an active lease only within the bounded attempt window", async () => {
        const service = new PlayerSyncStateService(source);
        const frozen = new Date("2026-10-25T01:00:00Z");
        jest.spyOn(service as any, "now").mockImplementation(
            async () => frozen,
        );
        await source.query(
            "UPDATE player_connection_sync SET nextEligibleAt = ?, retryAt = NULL WHERE connectionId = 1",
            [frozen],
        );
        const owner = (await service.claim(1, "account"))!;
        await service.start(owner);
        frozen.setTime(frozen.getTime() + 30_000);
        await service.renew(owner);
        const state = await source
            .getRepository(PlayerConnectionSync)
            .findOneByOrFail({ connectionId: 1 });
        expect(state.leaseExpiresAt!.getTime()).toBe(
            frozen.getTime() + PLAYER_OWNER_LEASE_MS,
        );
        frozen.setTime(frozen.getTime() + 10 * 60_000);
        await expect(service.renew(owner)).rejects.toBeInstanceOf(
            PlayerSyncOwnershipLost,
        );
    });

    it("rolls local writes back when ownership expires inside a transaction", async () => {
        const service = new PlayerSyncStateService(source);
        const frozen = new Date("2026-10-25T02:00:00Z");
        jest.spyOn(service as any, "now").mockImplementation(
            async () => new Date(frozen),
        );
        const owner = (await service.claim(1, "account"))!;
        await service.start(owner);
        await expect(
            service.ownedTransaction(owner, async (manager) => {
                await manager.query(
                    "INSERT INTO obtained_game_achievement VALUES (43, 1)",
                );
                frozen.setTime(frozen.getTime() + PLAYER_OWNER_LEASE_MS);
            }),
        ).rejects.toBeInstanceOf(PlayerSyncOwnershipLost);
        expect(
            await source.query(
                "SELECT * FROM obtained_game_achievement WHERE id = 43",
            ),
        ).toEqual([]);
    });
    const redisIt = process.env.PLAYER_IMPORT_TEST_REDIS_PORT ? it : it.skip;
    redisIt.each(["rejection", "lost acknowledgement", "death before enqueue"])(
        "recovers admission after %s (real MySQL/Redis)",
        async (scenario) => {
            const connectionId =
                6001 +
                [
                    "rejection",
                    "lost acknowledgement",
                    "death before enqueue",
                ].indexOf(scenario);
            await source.query(
                "INSERT INTO user_connection (id, sourceUserId) VALUES (?, 'account')",
                [connectionId],
            );
            const service = new PlayerSyncStateService(source);
            await service.initialize(connectionId, "account", new Date(0));
            const owner = (await service.claim(connectionId, "account"))!;
            const queue = new Queue("admission-fixture", {
                prefix: `player-admission-test-${randomUUID()}`,
                connection: {
                    host: "127.0.0.1",
                    port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
                    maxRetriesPerRequest: null,
                },
            });
            try {
                if (scenario === "death before enqueue") {
                    await source.query(
                        "UPDATE player_connection_sync SET leaseExpiresAt = DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE connectionId = ?",
                        [connectionId],
                    );
                    const successor = (await service.claim(
                        connectionId,
                        "account",
                    ))!;
                    expect(successor.ownerToken).not.toBe(owner.ownerToken);
                    await expect(
                        service.enqueue(owner, queue, "fixture", {}),
                    ).rejects.toBeInstanceOf(PlayerSyncOwnershipLost);
                    await service.enqueue(successor, queue, "fixture", {});
                } else {
                    const failure = new Error(
                        "fixture Redis acknowledgement failure",
                    );
                    const uncertainQueue = {
                        add: async (...args: any[]) => {
                            if (scenario === "lost acknowledgement")
                                await (queue.add as any)(...args);
                            throw failure;
                        },
                        getJob: queue.getJob.bind(queue),
                    } as any;
                    await expect(
                        service.enqueue(owner, uncertainQueue, "fixture", {}),
                    ).rejects.toBe(failure);
                    if (scenario === "rejection") {
                        const successor = (await service.claim(
                            connectionId,
                            "account",
                        ))!;
                        expect(successor).toBeTruthy();
                        await service.enqueue(successor, queue, "fixture", {});
                    } else {
                        expect(
                            await service.claim(connectionId, "account"),
                        ).toBeNull();
                        await service.enqueue(owner, queue, "fixture", {});
                    }
                }
                expect(await queue.getWaitingCount()).toBe(1);
                const [job] = await queue.getWaiting();
                const state = await source
                    .getRepository(PlayerConnectionSync)
                    .findOneByOrFail({ connectionId });
                expect(job.data.owner.ownerToken).toBe(state.ownerToken);
            } finally {
                await queue.obliterate();
                await queue.close();
            }
        },
    );
    it("keeps injected repository writes in the owner transaction", async () => {
        const connectionId = 6100;
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId) VALUES (?, 'account')",
            [connectionId],
        );
        const service = new PlayerSyncStateService(source);
        await service.initialize(connectionId, "account", new Date(0));
        const owner = (await service.claim(connectionId, "account"))!;
        await service.start(owner);
        const repo = source.getRepository(PlayerConnectionSync);
        const failure = new Error("rollback fixture");
        await expect(
            service.write(owner, async () => {
                await repo.update({ connectionId }, { outcome: "failed" });
                throw failure;
            }),
        ).rejects.toBe(failure);
        expect((await repo.findOneByOrFail({ connectionId })).outcome).toBe(
            "unknown",
        );
    });

    it("invalidates old-account writes on replacement and preserves settings-only cooldown", async () => {
        const connectionId = 6200;
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId) VALUES (?, 'account-a')",
            [connectionId],
        );
        const service = new PlayerSyncStateService(source);
        await service.initialize(connectionId, "account-a", new Date(0));
        const oldOwner = (await service.claim(connectionId, "account-a"))!;
        await service.start(oldOwner);
        await source.getRepository(PlayerGameSync).save({
            connectionId,
            externalGameId: 1,
            sourceUserId: "account-a",
            outcome: "empty",
            checkedAt: now,
            nextEligibleAt: now,
            reconcileAt: now,
        });
        const { runInTransaction } = require("typeorm-transactional");
        await runInTransaction(async () => {
            await source.manager.query(
                "UPDATE user_connection SET sourceUserId = 'account-b' WHERE id = ?",
                [connectionId],
            );
            await service.initialize(connectionId, "account-b", new Date(0));
        });
        const write = jest.fn();
        await expect(service.write(oldOwner, write)).rejects.toBeInstanceOf(
            PlayerSyncOwnershipLost,
        );
        expect(write).not.toHaveBeenCalled();
        expect(
            await source
                .getRepository(PlayerGameSync)
                .countBy({ connectionId }),
        ).toBe(0);
        const owner = (await service.claim(connectionId, "account-b"))!;
        await service.start(owner);
        await service.completeStage(owner, "playtime", "empty");
        await service.completeStage(owner, "discovery", "empty");
        await service.finish(owner);
        const before = await source
            .getRepository(PlayerConnectionSync)
            .findOneByOrFail({ connectionId });
        await service.initialize(connectionId, "account-b", new Date(0));
        expect(
            await source
                .getRepository(PlayerConnectionSync)
                .findOneByOrFail({ connectionId }),
        ).toEqual(before);
        expect(await service.claim(connectionId, "account-b")).toBeNull();
    });

    it("connection deletion cascades only synchronization state and rejects old work", async () => {
        const connectionId = 6300;
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId) VALUES (?, 'account')",
            [connectionId],
        );
        const service = new PlayerSyncStateService(source);
        await service.initialize(connectionId, "account", new Date(0));
        const owner = (await service.claim(connectionId, "account"))!;
        await source.getRepository(PlayerGameSync).save({
            connectionId,
            externalGameId: 1,
            sourceUserId: "account",
            nextEligibleAt: now,
            reconcileAt: now,
        });
        await source.query("DELETE FROM user_connection WHERE id = ?", [
            connectionId,
        ]);
        await expect(service.assertCurrent(owner)).rejects.toBeInstanceOf(
            PlayerSyncOwnershipLost,
        );
        expect(
            await source
                .getRepository(PlayerConnectionSync)
                .countBy({ connectionId }),
        ).toBe(0);
        expect(
            await source
                .getRepository(PlayerGameSync)
                .countBy({ connectionId }),
        ).toBe(0);
        expect(
            await source.query("SELECT * FROM obtained_game_achievement"),
        ).toEqual([{ id: 42, externalGameId: "2" }]);
    });
    it("bootstraps existing accounts once and keeps games with obtained rows unknown until checked", async () => {
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId) VALUES (6400, 'existing-account')",
        );
        const service = new PlayerSyncStateService(source);
        const frozen = new Date("2026-10-25T10:00:00Z");
        jest.spyOn(service as any, "now").mockImplementation(
            async () => frozen,
        );
        await service.bootstrapExisting();
        const before = await source
            .getRepository(PlayerConnectionSync)
            .findOneByOrFail({ connectionId: 6400 });
        expect(before.nextEligibleAt.getTime()).toBeGreaterThanOrEqual(
            frozen.getTime(),
        );
        expect(before.nextEligibleAt.getTime()).toBeLessThan(
            frozen.getTime() + 86400000,
        );
        frozen.setTime(frozen.getTime() + 1000);
        await service.bootstrapExisting();
        expect(
            await source
                .getRepository(PlayerConnectionSync)
                .findOneByOrFail({ connectionId: 6400 }),
        ).toEqual(before);
        await source.query("INSERT INTO game_external_game (id) VALUES (2)");
        expect(
            await source.query(
                "SELECT * FROM obtained_game_achievement WHERE externalGameId = 2",
            ),
        ).toHaveLength(1);
        await service.claim(6400, "existing-account", 2);
        expect(
            await source
                .getRepository(PlayerGameSync)
                .findOneByOrFail({ connectionId: 6400, externalGameId: 2 }),
        ).toMatchObject({ outcome: "unknown", checkedAt: null });
    });
    it("queries eligibility just before and exactly at its boundary", async () => {
        const service = new PlayerSyncStateService(source);
        const at = new Date("2026-10-27T00:00:00Z");
        let clock = new Date(at.getTime() - 1);
        jest.spyOn(service as any, "now").mockImplementation(async () => clock);
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId) VALUES (6500, 'boundary')",
        );
        await service.initialize(6500, "boundary", at);
        const cursor = { at: new Date(at.getTime() - 1), id: 0 };
        expect(await service.due(cursor)).toEqual([]);
        clock = at;
        expect(
            (await service.due(cursor)).map((row) => row.connectionId),
        ).toEqual([6500]);
    });

    const cycleIt = process.env.PLAYER_IMPORT_TEST_REDIS_PORT ? it : it.skip;
    cycleIt.each([
        EConnectionType.STEAM,
        EConnectionType.PSN,
        EConnectionType.XBOX,
    ])(
        "coordinates two %s instances, a restart, and two daily cycles",
        async (provider) => {
            const connectionId =
                6700 + Object.values(EConnectionType).indexOf(provider);
            const userId = `daily-${provider}`;
            let clock = new Date("2026-10-28T00:00:00Z");
            const first = new PlayerSyncStateService(source);
            const second = new PlayerSyncStateService(source);
            for (const state of [first, second])
                jest.spyOn(state as any, "now").mockImplementation(
                    async () => new Date(clock),
                );
            await source.query(
                "INSERT INTO user_connection (id, sourceUserId, profileUserId, type) VALUES (?, ?, ?, ?)",
                [connectionId, `${provider}-account`, userId, provider],
            );
            await first.initialize(connectionId, `${provider}-account`, clock);
            await source.query(
                "UPDATE player_connection_sync SET nextEligibleAt = DATE_ADD(?, INTERVAL 30 DAY) WHERE connectionId <> ?",
                [clock, connectionId],
            );
            await source.query(
                "CREATE TABLE IF NOT EXISTS player_stage_fixture (connectionId INT, stage VARCHAR(16), cycle INT, PRIMARY KEY (connectionId, stage, cycle))",
            );
            const connection = {
                host: "127.0.0.1",
                port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
                maxRetriesPerRequest: null,
            };
            const prefix = `player-daily-test-${randomUUID()}`;
            const queue = new Queue(PLAYER_DATA_QUEUE, { prefix, connection });
            const a = new PlayerDataQueueService(queue as any, first, {
                get: () => "true",
            } as any);
            const b = new PlayerDataQueueService(queue as any, second, {
                get: () => "true",
            } as any);
            let cycle = 1;
            const record = async (stage: string) => {
                const owner = currentPlayerSyncOwner()!;
                await playerSyncWrite(() =>
                    source.query(
                        "INSERT INTO player_stage_fixture VALUES (?, ?, ?)",
                        [owner.connectionId, stage, cycle],
                    ),
                );
            };
            const playtimeService = new PlaytimeService(
                source.getRepository(UserPlaytime),
                new PlaytimeHistoryService(
                    source.getRepository(UserPlaytimeHistory),
                    {} as any,
                ),
            );
            const importObservedPlaytime = async () => {
                const playtime = {
                    profileUserId: userId,
                    gameId: 1,
                    platformId: 6,
                    source: provider as any,
                    totalPlaytimeSeconds: cycle === 1 ? 100 : 110,
                    recentPlaytimeSeconds:
                        provider === EConnectionType.STEAM ? 10 : undefined,
                    totalPlayCount:
                        provider === EConnectionType.PSN ? 5 : undefined,
                    lastPlayedDate: null,
                    firstPlayedDate: null,
                };
                await playtimeService.saveImported(
                    [playtime],
                    await playtimeService.findForImport(
                        userId,
                        provider as any,
                        [1],
                    ),
                );
            };
            const playtime = {
                updatePlaytimeInfo: async (): Promise<any> =>
                    playtime.updateSteamPlaytimeInfo(),
                updateSteamPlaytimeInfo: async () => {
                    await record("playtime");
                    await importObservedPlaytime();
                    return { outcome: "complete" };
                },
                updatePsnPlaytimeInfo: async () => {
                    await record("playtime");
                    await importObservedPlaytime();
                    return { outcome: "complete" };
                },
                updateXboxPlaytimeInfo: async () => {
                    await record("playtime");
                    await importObservedPlaytime();
                    return { outcome: "complete" };
                },
            };
            const importer = {
                run: async () => {
                    await record("discovery");
                    return "empty";
                },
            };
            let worker: Worker | undefined;
            const execute = async (state: PlayerSyncStateService) => {
                const processor = new PlayerDataProcessor(
                    state,
                    playtime as any,
                    importer as any,
                );
                worker = new Worker(
                    PLAYER_DATA_QUEUE,
                    (job) => processor.process(job),
                    { prefix, connection },
                );
                await new Promise<void>((resolve, reject) => {
                    worker!.once("completed", () => resolve());
                    worker!.once("failed", (_job, error) => reject(error));
                    worker!.once("error", reject);
                });
                await worker.close();
                worker = undefined;
            };
            try {
                await Promise.all([
                    a.request(userId, provider),
                    b.registerDueJobs(),
                    b.request(userId, provider),
                ]);
                expect(await queue.getWaitingCount()).toBe(1);
                await execute(first);
                const status = await second.status(userId, provider);
                expect(status).toMatchObject({
                    status: "cooldown",
                    outcome: "complete",
                    lastSucceededAt: clock,
                });
                expect(JSON.stringify(status)).not.toContain("ownerToken");
                expect(JSON.stringify(status)).not.toContain("sourceUserId");
                expect((await queue.getCompleted()).length).toBe(1);
                const originalId = (await queue.getCompleted())[0].id;
                const restarted = new PlayerDataQueueService(
                    queue as any,
                    second,
                    { get: () => "true" } as any,
                );
                await restarted.onModuleInit();
                clock = new Date(clock.getTime() + 86400000 - 1);
                await expect(
                    restarted.request(userId, provider),
                ).resolves.toMatchObject({ status: "cooldown" });
                expect(await queue.getWaitingCount()).toBe(0);
                clock = new Date(clock.getTime() + 1);
                cycle = 2;
                await restarted.registerDueJobs();
                expect(await queue.getWaitingCount()).toBe(1);
                expect((await queue.getWaiting())[0].id).not.toBe(originalId);
                await execute(second);
                expect(await queue.getCompletedCount()).toBe(2);
                const current = await source
                    .getRepository(UserPlaytime)
                    .findOneByOrFail({ profileUserId: userId });
                expect(current.totalPlaytimeSeconds).toBe(110);
                expect(current.totalPlayCount).toBe(
                    provider === EConnectionType.PSN ? 5 : 0,
                );
                expect(current.recentPlaytimeSeconds).toBe(10);
                expect(
                    await source
                        .getRepository(UserPlaytimeHistory)
                        .countBy({ profileUserId: userId }),
                ).toBe(2);
                expect(
                    await source.query(
                        "SELECT stage, cycle FROM player_stage_fixture WHERE connectionId = ? ORDER BY cycle, stage",
                        [connectionId],
                    ),
                ).toEqual([
                    { stage: "discovery", cycle: 1 },
                    { stage: "playtime", cycle: 1 },
                    { stage: "discovery", cycle: 2 },
                    { stage: "playtime", cycle: 2 },
                ]);
            } finally {
                await worker?.close();
                await queue.obliterate();
                await queue.close();
            }
        },
    );
    it("failure preserves the last successful refresh and honors a later retry delay", async () => {
        const service = new PlayerSyncStateService(source);
        let clock = new Date("2026-10-30T00:00:00Z");
        jest.spyOn(service as any, "now").mockImplementation(
            async () => new Date(clock),
        );
        await source.query(
            "INSERT INTO user_connection (id, sourceUserId, profileUserId) VALUES (6900, 'account', 'failure-user')",
        );
        await service.initialize(6900, "account", clock);
        const first = (await service.claim(6900, "account"))!;
        await service.start(first);
        await service.completeStage(first, "playtime", "empty");
        await service.completeStage(first, "discovery", "empty");
        await service.finish(first);
        const success = new Date(clock);
        clock = new Date(clock.getTime() + 86400000);
        const retry = (await service.claim(6900, "account"))!;
        await service.start(retry);
        await service.finish(
            retry,
            new ProviderSyncError(
                "throttled",
                "fixture",
                undefined,
                429,
                7200000,
            ),
        );
        await expect(
            service.status("failure-user", EConnectionType.STEAM),
        ).resolves.toMatchObject({
            status: "failed",
            outcome: "throttled",
            lastSucceededAt: success,
            nextEligibleAt: new Date(clock.getTime() + 7200000),
        });
        await expect(
            service.status("another-user", EConnectionType.STEAM),
        ).resolves.toEqual({
            source: EConnectionType.STEAM,
            status: "disconnected",
        });
    });

    cycleIt(
        "new links run immediately, settings retain cooldown, and reconnect jobs reject old accounts",
        async () => {
            const state = new PlayerSyncStateService(source);
            const clock = new Date("2026-11-01T00:00:00Z");
            jest.spyOn(state as any, "now").mockImplementation(
                async () => new Date(clock),
            );
            const queue = new Queue(PLAYER_DATA_QUEUE, {
                prefix: `player-onboarding-test-${randomUUID()}`,
                connection: {
                    host: "127.0.0.1",
                    port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
                    maxRetriesPerRequest: null,
                },
            });
            const admission = new PlayerDataQueueService(queue as any, state, {
                get: () => "true",
            } as any);
            let account = "account-a";
            const registry = new ConnectionProviderRegistry();
            registry.register({
                type: EConnectionType.STEAM,
                name: "steam",
                iconName: "steam",
                authMode: EConnectionAuthMode.PUBLIC_IDENTIFIER,
                isImporterViable: true,
                isImporterWatchViable: true,
                isPlaytimeImportViable: true,
                isAchievementImportViable: true,
            });
            registry.registerAuthStrategy(EConnectionType.STEAM, {
                resolvePublicIdentifier: async () => ({
                    sourceUserId: account,
                    sourceUsername: "fixture",
                }),
            });
            const connections = new ConnectionsService(
                source.getRepository(UserConnection),
                new PlaytimeWatchService(admission),
                {} as any,
                state,
                registry,
                {} as any,
                {} as any,
            );
            const dto = {
                type: EConnectionType.STEAM,
                userIdentifier: "fixture",
                isAutoImportEnabled: false,
            };
            try {
                await connections.createOrUpdate("onboarding-user", dto);
                expect(await queue.getWaitingCount()).toBe(1);
                const oldJob = (await queue.getWaiting())[0];
                const owner = oldJob.data.owner;
                await state.start(owner);
                await state.completeStage(owner, "playtime", "empty");
                await state.completeStage(owner, "discovery", "empty");
                await state.finish(owner);
                const before = await state.status(
                    "onboarding-user",
                    EConnectionType.STEAM,
                );
                await connections.createOrUpdate("onboarding-user", {
                    ...dto,
                    isAutoImportEnabled: true,
                });
                expect(
                    await state.status(
                        "onboarding-user",
                        EConnectionType.STEAM,
                    ),
                ).toEqual(before);
                expect(await queue.getWaitingCount()).toBe(1);
                account = "account-b";
                await connections.createOrUpdate("onboarding-user", dto);
                expect(await queue.getWaitingCount()).toBe(2);
                const playtime = { updateSteamPlaytimeInfo: jest.fn() };
                const processor = new PlayerDataProcessor(
                    state,
                    playtime as any,
                    {} as any,
                );
                await expect(processor.process(oldJob as any)).resolves.toEqual(
                    { outcome: "stale-skip" },
                );
                expect(playtime.updateSteamPlaytimeInfo).not.toHaveBeenCalled();
                const current = (await queue.getWaiting()).find(
                    (job) => job.data.owner.sourceUserId === "account-b",
                );
                expect(current).toBeTruthy();
                expect(current!.data.owner.ownerToken).not.toBe(
                    owner.ownerToken,
                );
            } finally {
                await queue.obliterate();
                await queue.close();
            }
        },
    );
    cycleIt(
        "retries only a failed stage while retaining the other stage's committed result",
        async () => {
            const state = new PlayerSyncStateService(source);
            const clock = new Date("2026-11-02T00:00:00Z");
            jest.spyOn(state as any, "now").mockImplementation(
                async () => new Date(clock),
            );
            await source.query(
                "INSERT INTO user_connection (id, sourceUserId, profileUserId) VALUES (7100, 'account', 'stage-retry-user')",
            );
            await state.initialize(7100, "account", clock);
            const connection = {
                host: "127.0.0.1",
                port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
                maxRetriesPerRequest: null,
            };
            const prefix = `player-stage-test-${randomUUID()}`;
            const queue = new Queue(PLAYER_DATA_QUEUE, {
                prefix,
                connection,
                defaultJobOptions: { attempts: 2, backoff: 1 },
            });
            const admission = new PlayerDataQueueService(queue as any, state, {
                get: () => "true",
            } as any);
            let attempts = 0;
            const playtime = {
                updatePlaytimeInfo: async (): Promise<any> =>
                    playtime.updateSteamPlaytimeInfo(),
                updateSteamPlaytimeInfo: jest.fn(async () => {
                    if (++attempts === 1)
                        throw new Error("fixture failed write");
                    return { outcome: "empty" };
                }),
            };
            const importer = { run: jest.fn().mockResolvedValue("empty") };
            const processor = new PlayerDataProcessor(
                state,
                playtime as any,
                importer as any,
            );
            let firstFailure: PlayerConnectionSync | undefined;
            const worker = new Worker(
                PLAYER_DATA_QUEUE,
                (job) => processor.process(job),
                { prefix, connection },
            );
            try {
                await worker.waitUntilReady();
                const complete = new Promise<void>((resolve, reject) => {
                    worker.once("completed", () => resolve());
                    worker.on("failed", (job, error) => {
                        if (job && job.attemptsMade >= 2) reject(error);
                    });
                    worker.once("error", reject);
                });
                playtime.updateSteamPlaytimeInfo
                    .mockImplementationOnce(async () => {
                        throw new Error("fixture failed write");
                    })
                    .mockImplementation(async () => {
                        firstFailure = await source
                            .getRepository(PlayerConnectionSync)
                            .findOneByOrFail({ connectionId: 7100 });
                        return { outcome: "empty" };
                    });
                await admission.request(
                    "stage-retry-user",
                    EConnectionType.STEAM,
                );
                await complete;
                expect(playtime.updateSteamPlaytimeInfo).toHaveBeenCalledTimes(
                    2,
                );
                expect(importer.run).toHaveBeenCalledTimes(1);
                expect(firstFailure).toMatchObject({
                    lastSucceededAt: null,
                    stages: {
                        playtime: { outcome: "failed", lastSucceededAt: null },
                        discovery: {
                            outcome: "empty",
                            lastSucceededAt: clock.toISOString(),
                        },
                    },
                });
                expect(
                    await state.status(
                        "stage-retry-user",
                        EConnectionType.STEAM,
                    ),
                ).toMatchObject({
                    status: "cooldown",
                    outcome: "empty",
                    lastSucceededAt: clock,
                });
            } finally {
                await worker.close();
                await queue.obliterate();
                await queue.close();
            }
        },
    );
});
