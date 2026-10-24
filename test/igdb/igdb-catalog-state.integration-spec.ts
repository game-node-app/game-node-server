import "reflect-metadata";
import { DataSource } from "typeorm";
import { IgdbCatalogState } from "../../src/sync/igdb/catalog/entities/igdb-catalog-state.entity";
import { CreateIgdbCatalogState1792857600000 } from "../../src/migrations/1792857600000-CreateIgdbCatalogState";
import { testEnvironment } from "./helpers/test-environment";
import {
    IgdbCatalogStateService,
    CatalogOwner,
} from "../../src/sync/igdb/catalog/igdb-catalog-state.service";

describe("catalog state migration on isolated MySQL", () => {
    let source: DataSource;
    beforeAll(async () => {
        const settings = testEnvironment(process.env);
        source = await new DataSource({
            ...settings.mysql,
            timezone: "Z",
            entities: [IgdbCatalogState],
            migrations: [CreateIgdbCatalogState1792857600000],
            migrationsTableName: "igdb_test_migrations",
            connectTimeout: 5000,
        }).initialize();
    });
    afterAll(async () => {
        if (source?.isInitialized) await source.destroy();
    });

    it("runs up/down/up, enforces singleton, and preserves unrelated tables", async () => {
        await source.undoLastMigration();
        await source.query(
            "CREATE TABLE IF NOT EXISTS igdb_test_game_sentinel (id INT PRIMARY KEY)",
        );
        await source.query(
            "INSERT IGNORE INTO igdb_test_game_sentinel VALUES (42)",
        );
        try {
            await source.runMigrations();
            expect(await source.getRepository(IgdbCatalogState).find()).toEqual(
                [
                    expect.objectContaining({
                        id: 1,
                        status: "idle",
                        runId: null,
                    }),
                ],
            );
            await expect(
                source.query("INSERT INTO igdb_catalog_state (id) VALUES (2)"),
            ).rejects.toThrow();
            await source.undoLastMigration();
            expect(
                await source.query("SELECT id FROM igdb_test_game_sentinel"),
            ).toEqual([{ id: 42 }]);
            await source.runMigrations();
            expect(await source.getRepository(IgdbCatalogState).count()).toBe(
                1,
            );
        } finally {
            await source.query("DROP TABLE igdb_test_game_sentinel");
        }
    });

    it("persists boundary, cursor and retry state across reconnection and resume", async () => {
        const service = new IgdbCatalogStateService(source);
        const claimed = await service.claimRun();
        expect(claimed?.forceReconciliation).toBe(true);
        const owner = claimed as CatalogOwner;
        await service.setUpperId(owner, 100);
        await service.commitBatch(owner, 0, 20, 5);
        expect(await service.admitStageAttempt(owner, "game", 25, 3)).toBe(1);
        await service.pauseRun(owner, "Invalid game identity");
        await source.destroy();
        await source.initialize();
        expect((await service.readStatus()).retryBudgets).toEqual({
            "game:25": 1,
        });
        const resumed = await service.resumeRun();
        expect(resumed).toMatchObject({
            runId: owner.runId,
            committedId: 20,
            upperId: 100,
            committedGames: 5,
            attempt: 0,
            forceReconciliation: true,
        });
        const reclaimed = await service.claimRun(owner.runId);
        const newOwner = reclaimed as CatalogOwner;
        await service.renewLease(newOwner);
        await service.completeRun(newOwner, 14);
        const completed = await service.readStatus();
        expect(completed.status).toBe("completed");
        expect(
            completed.nextEligibleAt!.getTime() -
                completed.completedAt!.getTime(),
        ).toBe(14 * 86400000);
        expect(await service.claimRun()).toBeNull();
    });

    it("admits one claimant and rejects stale generations after takeover", async () => {
        await source.getRepository(IgdbCatalogState).update(1, {
            status: "idle",
            leaseExpiresAt: null,
            ownerToken: null,
            nextEligibleAt: null,
        });
        const first = new IgdbCatalogStateService(source);
        const second = new IgdbCatalogStateService(source);
        const claims = await Promise.all([first.claimRun(), second.claimRun()]);
        expect(claims.filter(Boolean)).toHaveLength(1);
        const oldOwner = claims.find(Boolean) as CatalogOwner;
        await first.setUpperId(oldOwner, 100);
        await first.commitBatch(oldOwner, 0, 10, 3);
        await source.query(
            "UPDATE igdb_catalog_state SET leaseExpiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = 1",
        );
        const newOwner = (await second.claimRun(
            oldOwner.runId,
        )) as CatalogOwner;
        expect(newOwner.ownerGeneration).toBe(oldOwner.ownerGeneration + 1);
        for (const operation of [
            () => first.renewLease(oldOwner),
            () => first.commitBatch(oldOwner, 10, 20, 3),
            () => first.pauseRun(oldOwner, "stale"),
            () => first.completeRun(oldOwner, 7),
        ]) {
            await expect(operation()).rejects.toThrow("ownership");
        }
        await expect(second.commitBatch(newOwner, 0, 5, 1)).rejects.toThrow(
            "checkpoint",
        );
        expect(await second.readStatus()).toMatchObject({
            committedId: 10,
            committedGames: 3,
            status: "running",
        });
        await second.commitBatch(newOwner, 10, 20, 2);
        await second.releaseOwnership(newOwner);
    });

    it("holds the ownership lock until game settlement and fences the old worker", async () => {
        const service = new IgdbCatalogStateService(source);
        const owner = (await service.claimRun()) as CatalogOwner;
        let unlock!: () => void;
        const gate = new Promise<void>((resolve) => {
            unlock = resolve;
        });
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const game = service.gameTransaction(owner, async (manager) => {
            const rows = await manager.query(
                "SELECT @@innodb_lock_wait_timeout AS lockTimeout, @@max_execution_time AS executionTimeout",
            );
            expect({
                lockTimeout: Number(rows[0].lockTimeout),
                executionTimeout: Number(rows[0].executionTimeout),
            }).toEqual({
                lockTimeout: 10,
                executionTimeout: 30000,
            });
            // Expire only in the held transaction. Takeover must wait for commit.
            await manager.query(
                "UPDATE igdb_catalog_state SET leaseExpiresAt = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = 1",
            );
            entered();
            await gate;
        });
        await Promise.race([started, game]);
        let takenOver = false;
        const takeover = service.claimRun(owner.runId).then((claimed) => {
            takenOver = true;
            return claimed;
        });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(takenOver).toBe(false);
        unlock();
        await game;
        const nextOwner = (await takeover) as CatalogOwner;
        expect(nextOwner.ownerGeneration).toBe(owner.ownerGeneration + 1);
        const write = jest.fn();
        await expect(service.gameTransaction(owner, write)).rejects.toThrow(
            "ownership",
        );
        expect(write).not.toHaveBeenCalled();
        await expect(
            service.gameTransaction(nextOwner, async () => {
                throw new Error("injected game failure");
            }),
        ).rejects.toThrow("injected");
        await service.gameTransaction(nextOwner, async () => undefined);
        await service.releaseOwnership(nextOwner);
    });

    it("cancels an overlong game transaction and releases its ownership lock", async () => {
        const service = new IgdbCatalogStateService(source);
        const owner = (await service.claimRun()) as CatalogOwner;
        const schedule = global.setTimeout;
        let expire!: () => void;
        const timerSpy = jest.spyOn(global, "setTimeout").mockImplementation(((
            callback: () => void,
            ms: number,
        ) => {
            if (ms === 60000) expire = callback;
            return schedule(callback, ms);
        }) as typeof setTimeout);
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const game = service.gameTransaction(owner, async (manager) => {
            await manager.query(
                "UPDATE igdb_catalog_state SET committedGames = 999 WHERE id = 1",
            );
            entered();
            await manager.query("SELECT SLEEP(30)");
        });
        // Attach a rejection handler before cancellation to avoid an unhandled rejection.
        const failed = expect(game).rejects.toThrow();
        try {
            await Promise.race([started, game]);
            expire();
            await failed;
            expect(await service.readStatus()).toMatchObject({
                committedGames: 5,
            });
            await service.releaseOwnership(owner);
        } finally {
            timerSpy.mockRestore();
        }
    });
});
