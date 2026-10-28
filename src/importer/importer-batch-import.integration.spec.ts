import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import {
    addTransactionalDataSource,
    deleteDataSourceByName,
    initializeTransactionalContext,
    runInTransaction,
    StorageDriver,
} from "typeorm-transactional";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { Profile } from "../profile/entities/profile.entity";
import { Library } from "../libraries/entities/library.entity";
import { UserConnection } from "../connection/entity/user-connection.entity";
import { EConnectionType } from "../connection/connections.constants";
import { ConnectionProviderRegistry } from "../connection/connection-provider.registry";
import { ImporterProcessedEntry } from "./entity/importer-processed-entry.entity";
import { ImporterIgnoredEntry } from "./entity/importer-ignored-entry.entity";
import { GameExternalGame } from "../game/external-game/entity/game-external-game.entity";
import { GamePlatform } from "../game/game-repository/entities/game-platform.entity";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryToCollection } from "../collections/collections-entries/entities/collection-entry-to-collection.entity";
import { Collection } from "../collections/entities/collection.entity";
import { CollectionEntryStatus } from "../collections/collections-entries/collections-entries.constants";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { ImporterService } from "./importer.service";
import { ImporterBatchImportService } from "./importer-batch-import.service";
import { ImporterBatchEffectsService } from "./importer-batch-effects.service";
import { ImporterBatchEffect } from "./entity/importer-batch-effect.entity";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { Game } from "../game/game-repository/entities/game.entity";
import { ExternalGameService } from "../game/external-game/external-game.service";
import { ConnectionsSummaryService } from "../connection/connections-summary.service";
import { PlayerConnectionSync } from "../sync/player-data/entity/player-connection-sync.entity";
import { EImporterSource } from "./importer.constants";

const mysqlDescribe = process.env.IGDB_TEST_MYSQL_PORT
    ? describe
    : describe.skip;
mysqlDescribe("batch import transactions", () => {
    let source: DataSource;
    const users: string[] = [];
    beforeAll(async () => {
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        source = await createNotificationTestDataSource();
        addTransactionalDataSource(source);
        await source.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (2, 'Batch fixture', 'batch-fixture')",
        );
        await source
            .getRepository(GamePlatform)
            .upsert({ id: 6, name: "PC", abbreviation: "PC" }, ["id"]);
        await source.getRepository(GameExternalGame).upsert(
            [
                { id: 98765101, gameId: 1, uid: "batch-import-a", category: 1 },
                { id: 98765102, gameId: 2, uid: "batch-import-b", category: 1 },
                { id: 98765103, gameId: 2, uid: "batch-import-c", category: 1 },
            ],
            ["id"],
        );
    }, 120000);
    afterAll(async () => {
        for (const userId of users)
            await source.getRepository(Profile).delete({ userId });
        deleteDataSourceByName("default");
        await source?.destroy();
    });
    afterEach(async () => {
        for (const userId of users)
            await source
                .getRepository(ImporterBatchEffect)
                .delete({ libraryUserId: userId });
    });
    async function fixture() {
        const userId = randomUUID();
        users.push(userId);
        await source
            .getRepository(Profile)
            .insert({ userId, username: `imp_${userId.slice(0, 12)}` });
        await source.getRepository(Library).insert({ userId });
        const connection = await source.getRepository(UserConnection).save({
            profileUserId: userId,
            type: EConnectionType.STEAM,
            sourceUserId: "account",
            sourceUsername: "account",
        });
        const processed = source.getRepository(ImporterProcessedEntry);
        const ignored = source.getRepository(ImporterIgnoredEntry);
        const registry = new ConnectionProviderRegistry();
        const importer = new ImporterService(
            processed,
            ignored,
            {} as any,
            { findOneByUserIdAndTypeOrFail: async () => connection } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            registry,
            source.getRepository(CollectionEntry),
            source.getRepository(Game),
        );
        registry.register({
            ...registry.get("steam"),
            syncHandlers: {
                fetchLibraryGames: async () =>
                    [98765101, 98765102, 98765103].map((id, index) => ({
                        id,
                        uid: index === 0 ? "batch-import-a" : "batch-import-b",
                        gameId: index === 0 ? 1 : 2,
                        preferredPlatformId: 6,
                    })) as any,
            },
        });
        const activities = { register: jest.fn().mockResolvedValue(undefined) };
        const achievements = {
            addTrackingJob: jest.fn().mockResolvedValue(undefined),
        };
        const levels = {
            increaseExp: jest.fn().mockResolvedValue(undefined),
            registerLevelExpIncreaseActivity: jest.fn(),
        };
        const collections = {
            findAllByIds: async (ids: string[]) =>
                source.getRepository(Collection).findByIds(ids),
        };
        const entries = new CollectionsEntriesService(
            source.getRepository(CollectionEntry),
            source.getRepository(CollectionEntryToCollection),
            activities as any,
            achievements as any,
            levels as any,
            collections as any,
            {} as any,
        );
        const effects = new ImporterBatchEffectsService(
            source.getRepository(ImporterBatchEffect),
            levels as any,
            activities as any,
            achievements as any,
        );
        const trigger = { recover: jest.fn().mockResolvedValue(undefined) };
        const batch = new ImporterBatchImportService(
            importer,
            entries,
            trigger as any,
            processed,
            ignored,
        );
        return {
            userId,
            batch,
            importer,
            entries,
            processed,
            ignored,
            activities,
            achievements,
            levels,
            registry,
            connection,
            effects,
            trigger,
        };
    }
    it("imports distinct games once, marks every selected ID and preserves existing data", async () => {
        const f = await fixture();
        const existing = await source.getRepository(CollectionEntry).save({
            libraryUserId: f.userId,
            gameId: 1,
            status: CollectionEntryStatus.FINISHED,
            isFavorite: true,
        });
        const collection = await source.getRepository(Collection).save({
            libraryUserId: f.userId,
            name: "Import",
            defaultEntryStatus: CollectionEntryStatus.FINISHED,
        });
        const result = await f.batch.import(f.userId, EImporterSource.STEAM, {
            importAll: true,
            status: CollectionEntryStatus.PLAYING,
            collectionIds: [collection.id],
        });
        await f.effects.recover();
        expect(result).toEqual({ importedCount: 1, skippedCount: 1 });
        expect(await f.processed.countBy({ libraryUserId: f.userId })).toBe(3);
        expect(
            await f.batch.import(f.userId, EImporterSource.STEAM, {
                importAll: true,
            }),
        ).toEqual({ importedCount: 0, skippedCount: 0 });
        await expect(
            f.batch.import(f.userId, EImporterSource.STEAM, {
                externalGameIds: [98765101],
            }),
        ).rejects.toMatchObject({ status: 409 });
        expect(
            await source
                .getRepository(CollectionEntry)
                .findOneByOrFail({ id: existing.id }),
        ).toMatchObject({
            status: CollectionEntryStatus.FINISHED,
            isFavorite: true,
        });
        const created = await source
            .getRepository(CollectionEntry)
            .findOneOrFail({
                where: { libraryUserId: f.userId, gameId: 2 },
                relations: { ownedPlatforms: true, collectionsMap: true },
            });
        expect(created.status).toBe(CollectionEntryStatus.PLAYING);
        expect(created.ownedPlatforms.map((platform) => platform.id)).toEqual([
            6,
        ]);
        expect(created.collectionsMap.map((map) => map.collectionId)).toEqual([
            collection.id,
        ]);
        expect(f.levels.increaseExp).toHaveBeenCalledTimes(1);
        expect(f.activities.register).toHaveBeenCalledTimes(1);
    });
    it("rejects another user's collection without changes", async () => {
        const f = await fixture();
        const other = await fixture();
        const collection = await source
            .getRepository(Collection)
            .save({ libraryUserId: other.userId, name: "Private" });
        await expect(
            f.batch.import(f.userId, EImporterSource.STEAM, {
                externalGameIds: [98765101],
                collectionIds: [collection.id],
            }),
        ).rejects.toMatchObject({ status: 400 });
        expect(
            await source
                .getRepository(CollectionEntry)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
        expect(await f.processed.countBy({ libraryUserId: f.userId })).toBe(0);
    });
    it("deduplicates repeated IDs while marking distinct IDs for one game", async () => {
        const f = await fixture();
        expect(
            await f.batch.import(f.userId, EImporterSource.STEAM, {
                externalGameIds: [98765102, 98765102, 98765103],
            }),
        ).toEqual({ importedCount: 1, skippedCount: 0 });
        expect(await f.processed.countBy({ libraryUserId: f.userId })).toBe(2);
        expect(
            await source
                .getRepository(CollectionEntry)
                .countBy({ libraryUserId: f.userId, gameId: 2 }),
        ).toBe(1);
    });
    it("does not import mappings hidden by an already processed provider identity", async () => {
        const f = await fixture();
        await f.batch.import(f.userId, EImporterSource.STEAM, {
            externalGameIds: [98765103],
        });
        expect(
            await f.batch.import(f.userId, EImporterSource.STEAM, {
                importAll: true,
            }),
        ).toEqual({ importedCount: 1, skippedCount: 0 });
        expect(await f.processed.countBy({ libraryUserId: f.userId })).toBe(2);
    });
    it("rolls back entries and effects if marker persistence fails", async () => {
        const f = await fixture();
        const spy = jest
            .spyOn(f.processed, "insert")
            .mockRejectedValueOnce(new Error("injected failure"));
        await expect(
            f.batch.import(f.userId, EImporterSource.STEAM, {
                importAll: true,
            }),
        ).rejects.toThrow("injected failure");
        spy.mockRestore();
        expect(
            await source
                .getRepository(CollectionEntry)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
        expect(await f.processed.countBy({ libraryUserId: f.userId })).toBe(0);
        expect(f.levels.increaseExp).not.toHaveBeenCalled();
        expect(f.achievements.addTrackingJob).not.toHaveBeenCalled();
        expect(f.activities.register).not.toHaveBeenCalled();
    });
    it("reports committed counts when post-commit publication fails", async () => {
        const f = await fixture();
        f.levels.increaseExp.mockRejectedValueOnce(
            new Error("publication failure"),
        );
        expect(
            await f.batch.import(f.userId, EImporterSource.STEAM, {
                externalGameIds: [98765101],
            }),
        ).toEqual({ importedCount: 1, skippedCount: 0 });
        await f.effects.recover();
        expect(await f.processed.countBy({ libraryUserId: f.userId })).toBe(1);
        expect(
            await source
                .getRepository(CollectionEntry)
                .findOneByOrFail({ libraryUserId: f.userId, gameId: 1 }),
        ).toMatchObject({ status: CollectionEntryStatus.PLANNED });
        expect(
            await source
                .getRepository(ImporterBatchEffect)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(1);
        await source
            .getRepository(ImporterBatchEffect)
            .update(
                { libraryUserId: f.userId },
                { nextAttemptAt: new Date(0) },
            );
        await f.effects.recover();
        expect(
            await source
                .getRepository(ImporterBatchEffect)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
    });
    it("does not publish effects when an enclosing transaction rolls back", async () => {
        const f = await fixture();
        await expect(
            runInTransaction(async () => {
                await f.batch.import(f.userId, EImporterSource.STEAM, {
                    externalGameIds: [98765101],
                });
                throw new Error("outer rollback");
            }),
        ).rejects.toThrow("outer rollback");
        await new Promise((resolve) => setImmediate(resolve));
        expect(
            await source
                .getRepository(CollectionEntry)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
        expect(f.levels.increaseExp).not.toHaveBeenCalled();
        expect(
            await source
                .getRepository(ImporterBatchEffect)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
    });
    it("preserves a manual entry committed while a batch waits", async () => {
        const f = await fixture();
        let release!: () => void;
        let locked!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            locked = resolve;
        });
        const first = runInTransaction(async () => {
            await f.entries.createOrUpdate(f.userId, {
                gameId: 1,
                platformIds: [6],
                collectionIds: [],
                status: CollectionEntryStatus.FINISHED,
            });
            locked();
            await held;
        });
        await ready;
        const batch = f.batch.import(f.userId, EImporterSource.STEAM, {
            externalGameIds: [98765101],
        });
        release();
        await first;
        expect(await batch).toEqual({ importedCount: 0, skippedCount: 1 });
        expect(
            await source
                .getRepository(CollectionEntry)
                .findOneByOrFail({ libraryUserId: f.userId, gameId: 1 }),
        ).toMatchObject({ status: CollectionEntryStatus.FINISHED });
        expect(
            await source
                .getRepository(CollectionEntry)
                .countBy({ libraryUserId: f.userId, gameId: 1 }),
        ).toBe(1);
    });
    it("manual creation waiting on a batch updates the same entry", async () => {
        const f = await fixture();
        let release!: () => void;
        let locked!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            locked = resolve;
        });
        const first = runInTransaction(async () => {
            await f.batch.import(f.userId, EImporterSource.STEAM, {
                externalGameIds: [98765101],
            });
            locked();
            await held;
        });
        await ready;
        const manual = f.entries.createOrUpdate(f.userId, {
            gameId: 1,
            platformIds: [6],
            collectionIds: [],
            status: CollectionEntryStatus.FINISHED,
        });
        expect(f.levels.increaseExp).not.toHaveBeenCalled();
        release();
        await first;
        await manual;
        expect(
            await source
                .getRepository(CollectionEntry)
                .findOneByOrFail({ libraryUserId: f.userId, gameId: 1 }),
        ).toMatchObject({ status: CollectionEntryStatus.FINISHED });
        expect(
            await source
                .getRepository(CollectionEntry)
                .countBy({ libraryUserId: f.userId, gameId: 1 }),
        ).toBe(1);
    });
    it("rejects an account replaced after provider discovery", async () => {
        const f = await fixture();
        f.registry.get("steam").syncHandlers!.fetchLibraryGames = async () => {
            await source
                .getRepository(UserConnection)
                .update(
                    { id: f.connection.id },
                    { sourceUserId: "replacement" },
                );
            return [{ id: 98765101, gameId: 1, preferredPlatformId: 6 }] as any;
        };
        await expect(
            f.batch.import(f.userId, EImporterSource.STEAM, {
                externalGameIds: [98765101],
            }),
        ).rejects.toMatchObject({ status: 409 });
        expect(
            await source
                .getRepository(CollectionEntry)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
    });
    it("rejects a status committed while the import waits", async () => {
        const f = await fixture();
        let release!: () => void;
        let locked!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            locked = resolve;
        });
        const first = runInTransaction(async () => {
            await f.importer.changeStatus(f.userId, {
                externalGameId: 98765101,
                status: "ignored",
            });
            locked();
            await held;
        });
        await ready;
        const batch = f.batch.import(f.userId, EImporterSource.STEAM, {
            externalGameIds: [98765101],
        });
        release();
        await first;
        await expect(batch).rejects.toMatchObject({ status: 409 });
        expect(
            await source
                .getRepository(CollectionEntry)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
    });
    it("retries publication without granting XP twice", async () => {
        const f = await fixture();
        const collection = await source
            .getRepository(Collection)
            .save({ libraryUserId: f.userId, name: "Retry" });
        const secondCollection = await source
            .getRepository(Collection)
            .save({ libraryUserId: f.userId, name: "Retry second" });
        const levels = new LevelService(source.getRepository(UserLevel));
        const effects = new ImporterBatchEffectsService(
            source.getRepository(ImporterBatchEffect),
            levels,
            f.activities as any,
            f.achievements as any,
        );
        f.activities.register
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("queue unavailable"));
        await f.batch.import(f.userId, EImporterSource.STEAM, {
            externalGameIds: [98765101],
            collectionIds: [collection.id, secondCollection.id],
        });
        await effects.recover();
        expect(
            await source
                .getRepository(ImporterBatchEffect)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(1);
        expect(
            await source
                .getRepository(UserLevel)
                .findOneBy({ userId: f.userId }),
        ).toBeNull();
        await source
            .getRepository(ImporterBatchEffect)
            .update(
                { libraryUserId: f.userId },
                { nextAttemptAt: new Date(0) },
            );
        await effects.recover();
        expect(
            await source
                .getRepository(ImporterBatchEffect)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
        expect(
            await source
                .getRepository(UserLevel)
                .findOneByOrFail({ userId: f.userId }),
        ).toMatchObject({ currentLevelExp: 30 });
        expect(f.activities.register.mock.calls[0][1]).toBe(
            f.activities.register.mock.calls[2][1],
        );
    });
    it("starts durable delivery after the import commits", async () => {
        const f = await fixture();
        const effects = new ImporterBatchEffectsService(
            source.getRepository(ImporterBatchEffect),
            new LevelService(source.getRepository(UserLevel)),
            f.activities as any,
            f.achievements as any,
        );
        const recover = jest.spyOn(effects, "recover");
        const batch = new ImporterBatchImportService(
            f.importer,
            f.entries,
            effects,
            f.processed,
            f.ignored,
        );
        await batch.import(f.userId, EImporterSource.STEAM, {
            externalGameIds: [98765101],
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(recover).toHaveBeenCalledTimes(1);
        await recover.mock.results[0].value;
        expect(
            await source
                .getRepository(ImporterBatchEffect)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
        expect(
            await source
                .getRepository(UserLevel)
                .findOneByOrFail({ userId: f.userId }),
        ).toMatchObject({ currentLevelExp: 30 });
    });
    it("measures provider calls and local queries for representative batches", async () => {
        const games = Array.from({ length: 25 }, (_, index) => ({
            id: 98800000 + index,
            externalId: 98810000 + index,
        }));
        await source.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES ?",
            [
                games.map((game) => [
                    game.id,
                    `Bench ${game.id}`,
                    `bench-${game.id}`,
                ]),
            ],
        );
        await source.getRepository(GameExternalGame).upsert(
            games.map((game) => ({
                id: game.externalId,
                gameId: game.id,
                uid: String(game.externalId),
                category: 1,
            })),
            ["id"],
        );
        const measurements: any = {};
        for (const size of [1, 25]) {
            const f = await fixture();
            const provider = jest
                .fn()
                .mockResolvedValue(
                    games
                        .slice(0, size)
                        .map((game) => ({ game: { id: game.externalId } })),
                );
            Object.assign(f.importer, {
                steamSyncService: { getLibraryGames: provider },
                externalGameService: new ExternalGameService(
                    source.getRepository(GameExternalGame),
                    {} as any,
                ),
            });
            f.registry.registerSyncHandlers(EConnectionType.STEAM, {
                fetchLibraryGames: (userId, includeMarked, sourceUserId) =>
                    (f.importer as any).findUnprocessedSteamEntries(
                        userId,
                        includeMarked,
                        sourceUserId,
                    ),
            });
            const summary = new ConnectionsSummaryService(
                source.getRepository(CollectionEntry),
                source.getRepository(PlayerConnectionSync),
                f.registry,
                {
                    findOneByUserIdAndType: () =>
                        source
                            .getRepository(UserConnection)
                            .findOneBy({ id: f.connection.id }),
                } as any,
            );
            let queries = 0;
            const logger = jest
                .spyOn(source.logger, "logQuery")
                .mockImplementation(() => {
                    queries++;
                });
            const measure = async (work: () => Promise<unknown>) => {
                queries = 0;
                provider.mockClear();
                const started = performance.now();
                await work();
                return {
                    queries,
                    providerCalls: provider.mock.calls.length,
                    milliseconds:
                        Math.round((performance.now() - started) * 10) / 10,
                };
            };
            measurements[size] = {
                listing: await measure(() =>
                    f.importer.findUnprocessedEntries(
                        f.userId,
                        EImporterSource.STEAM,
                        { excludeInLibrary: true },
                    ),
                ),
                summary: await measure(() =>
                    summary.enrich(f.userId, [f.connection as any]),
                ),
                batch: await measure(() =>
                    f.batch.import(f.userId, EImporterSource.STEAM, {
                        importAll: true,
                    }),
                ),
            };
            logger.mockRestore();
        }
        console.log("IMPORTER_MEASUREMENTS", JSON.stringify(measurements));
        for (const operation of ["listing", "summary", "batch"]) {
            expect(measurements[1][operation].providerCalls).toBe(1);
            expect(measurements[25][operation].providerCalls).toBe(1);
            expect(measurements[25][operation].queries).toBe(
                measurements[1][operation].queries,
            );
        }
    });
});
