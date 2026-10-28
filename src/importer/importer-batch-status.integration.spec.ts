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
import { ImporterService } from "./importer.service";
import { EImporterSource } from "./importer.constants";
import { ImporterWatchProcessor } from "./importer-watch/importer-watch.processor";

const mysqlDescribe = process.env.IGDB_TEST_MYSQL_PORT
    ? describe
    : describe.skip;
mysqlDescribe("batch status transactions", () => {
    let source: DataSource;
    const users: string[] = [];
    beforeAll(async () => {
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        source = await createNotificationTestDataSource();
        addTransactionalDataSource(source);
        await source.getRepository(GameExternalGame).upsert(
            {
                id: 98765001,
                gameId: 1,
                uid: "batch-status-test",
                category: 1,
            },
            ["id"],
        );
    }, 120000);
    afterAll(async () => {
        for (const userId of users)
            await source.getRepository(Profile).delete({ userId });
        deleteDataSourceByName("default");
        await source?.destroy();
    });
    async function fixture() {
        const userId = randomUUID();
        users.push(userId);
        await source
            .getRepository(Profile)
            .insert({ userId, username: `batch_${userId.slice(0, 12)}` });
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
        const service = new ImporterService(
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
            {} as any,
            {} as any,
        );
        registry.register({
            ...registry.get("steam"),
            syncHandlers: {
                fetchLibraryGames: async () =>
                    [{ id: 98765001, gameId: 1 }] as any,
            },
        });
        return { service, userId, ignored };
    }
    it("rolls back an insert if a later write fails", async () => {
        const { service, userId, ignored } = await fixture();
        const original = ignored.insert.bind(ignored);
        const spy = jest
            .spyOn(ignored, "insert")
            .mockImplementation(async (rows) => {
                await original(rows);
                throw new Error("injected failure");
            });
        await expect(
            service.changeStatusBatch(userId, {
                source: EImporterSource.STEAM,
                externalGameIds: [98765001],
                status: "ignored",
            }),
        ).rejects.toThrow("injected failure");
        spy.mockRestore();
        expect(await ignored.countBy({ libraryUserId: userId })).toBe(0);
    });
    it("serializes competing opposite batches", async () => {
        const { service, userId } = await fixture();
        const results = await Promise.allSettled(
            ["processed", "ignored"].map((status: "processed" | "ignored") =>
                service.changeStatusBatch(userId, {
                    source: EImporterSource.STEAM,
                    externalGameIds: [98765001],
                    status,
                }),
            ),
        );
        expect(
            results.filter((result) => result.status === "fulfilled"),
        ).toHaveLength(1);
        expect(
            results.filter((result) => result.status === "rejected"),
        ).toHaveLength(1);
    });
    it.each(["individual", "automatic"])(
        "serializes a batch behind an %s status writer",
        async (writer) => {
            const { service, userId, ignored } = await fixture();
            let release!: () => void;
            let locked!: () => void;
            const held = new Promise<void>((resolve) => {
                release = resolve;
            });
            const ready = new Promise<void>((resolve) => {
                locked = resolve;
            });
            const first = runInTransaction(async () => {
                await service.lockLibrary(userId);
                if (writer === "individual")
                    await service.changeStatus(userId, {
                        externalGameId: 98765001,
                        status: "processed",
                    });
                else await service.markProcessed(userId, 98765001);
                locked();
                await held;
            });
            await ready;
            const batch = service.changeStatusBatch(userId, {
                source: EImporterSource.STEAM,
                externalGameIds: [98765001],
                status: "ignored",
            });
            release();
            await first;
            await expect(batch).rejects.toMatchObject({ status: 409 });
            expect(await ignored.countBy({ libraryUserId: userId })).toBe(0);
        },
    );
    it("the automatic importer observes a batch committed while it waits", async () => {
        const { service, userId } = await fixture();
        let release!: () => void;
        let locked!: () => void;
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
            locked = resolve;
        });
        const first = runInTransaction(async () => {
            await service.changeStatusBatch(userId, {
                source: EImporterSource.STEAM,
                externalGameIds: [98765001],
                status: "ignored",
            });
            locked();
            await held;
        });
        await ready;
        const createForImport = jest.fn();
        const processor = new ImporterWatchProcessor(
            {
                findBy: jest
                    .fn()
                    .mockResolvedValue([
                        {
                            gameExternalGameId: 98765001,
                            autoImportRetryable: true,
                        },
                    ]),
                upsert: jest.fn(),
            } as any,
            {} as any,
            service,
            {
                findOneByUserIdAndType: jest
                    .fn()
                    .mockResolvedValue({ isAutoImportEnabled: true }),
            } as any,
            { createForImport } as any,
        );
        const watch = (processor as any).commitPage(
            { userId, source: EImporterSource.STEAM },
            [{ id: 98765001, gameId: 1, preferredPlatformId: 6 }],
        );
        release();
        await first;
        await watch;
        expect(createForImport).not.toHaveBeenCalled();
    });
});
