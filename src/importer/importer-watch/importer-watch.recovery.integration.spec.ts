import { ConnectionProviderRegistry } from "../../connection/connection-provider.registry";
import { Queue, Worker, QueueEvents } from "bullmq";
import { UserConnection } from "../../connection/entity/user-connection.entity";
import { EConnectionType } from "../../connection/connections.constants";
import { PlayerConnectionSync } from "../../sync/player-data/entity/player-connection-sync.entity";
import { PlayerGameSync } from "../../sync/player-data/entity/player-game-sync.entity";
import { PlayerSyncStateService } from "../../sync/player-data/player-sync-state.service";
import { PlayerDataQueueService } from "../../sync/player-data/player-data-queue.service";
import { PlayerDataProcessor } from "../../sync/player-data/player-data.processor";
import { PLAYER_DATA_QUEUE } from "../../sync/player-data/player-data.constants";
import { PlaytimeService } from "../../playtime/playtime.service";
import { PlaytimeHistoryService } from "../../playtime/playtime-history.service";
import { UserPlaytime } from "../../playtime/entity/user-playtime.entity";
import { UserPlaytimeHistory } from "../../playtime/entity/user-playtime-history.entity";
import { PlaytimeWatchProcessor } from "../../playtime/watch/playtime-watch.processor";
import { SteamSyncService } from "../../sync/steam/steam-sync.service";
import { ExternalGameService } from "../../game/external-game/external-game.service";
import { PsnExtraMappings } from "../../game/external-game/entity/psn-extra-mappings.entity";
import { GameAchievementSyncQueueService } from "../../game/game-achievement/sync/game-achievement-sync-queue.service";
import { GAME_ACHIEVEMENT_SYNC_QUEUE_NAME } from "../../game/game-achievement/sync/game-achievement-sync.constants";
import { GameObtainedAchievementService } from "../../game/game-achievement/game-obtained-achievement.service";
import { GameAchievementSyncProcessor } from "../../game/game-achievement/sync/game-achievement-sync.processor";
import { GameAchievementActivityService } from "../../game/game-achievement/game-achievement-activity.service";
import { GameAchievementStatusService } from "../../game/game-achievement/game-achievement-status.service";
import { ObtainedGameAchievement } from "../../game/game-achievement/entity/obtained-game-achievement.entity";
import { ObtainedGameAchievementActivity } from "../../game/game-achievement/entity/obtained-game-achievement-activity.entity";
import { GameCompletionStatus } from "../../game/game-achievement/entity/game-completion-status.entity";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";
import { ActivitiesRepositoryService } from "../../activities/activities-repository/activities-repository.service";
import { ActivitiesQueueService } from "../../activities/activities-queue/activities-queue.service";
import { NotificationsQueueService } from "../../notifications/notifications-queue.service";
import { NOTIFICATIONS_QUEUE_NAME } from "../../notifications/notifications.constants";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DataSource, Table } from "typeorm";
import {
    addTransactionalDataSource,
    deleteDataSourceByName,
    initializeTransactionalContext,
    StorageDriver,
} from "typeorm-transactional";
import { ImporterWatchProcessor } from "./importer-watch.processor";
import { ImporterService } from "../importer.service";
import { ImporterNotifiedEntry } from "../entity/importer-notified-entry.entity";
import { ImporterProcessedEntry } from "../entity/importer-processed-entry.entity";
import { ImporterIgnoredEntry } from "../entity/importer-ignored-entry.entity";
import { ImporterWatchNotification } from "../entity/importer-notification.entity";
import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
import { GamePlatform } from "../../game/game-repository/entities/game-platform.entity";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { Library } from "../../libraries/entities/library.entity";
import { Notification } from "../../notifications/entity/notification.entity";
import { NotificationsService } from "../../notifications/notifications.service";
import { EImporterSource } from "../importer.constants";
import {
    ENotificationCategory,
    NotificationSourceType,
} from "../../notifications/notifications.constants";
import { RecoverImporterNotifications1792886400004 } from "../../migrations/1792886400004-RecoverImporterNotifications";

const mysqlDescribe = process.env.PLAYER_IMPORT_TEST_MYSQL_PORT
    ? describe
    : describe.skip;
mysqlDescribe("import and notification recovery on disposable MySQL", () => {
    const database = `player_import_test_${randomUUID().replaceAll("-", "")}`;
    let source: DataSource;
    let admin: DataSource;
    beforeAll(async () => {
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        const options = {
            type: "mysql" as const,
            host: "127.0.0.1",
            port: Number(process.env.PLAYER_IMPORT_TEST_MYSQL_PORT),
            username: "root",
            password: "",
            timezone: "Z",
            bigNumberStrings: false,
        };
        admin = await new DataSource(options).initialize();
        await admin.query(`CREATE DATABASE \`${database}\``);
        source = await new DataSource({
            ...options,
            database,
            entities: [resolve(__dirname, "../..", "**/*.entity.ts")],
        }).initialize();
        addTransactionalDataSource(source);
        const runner = source.createQueryRunner();
        try {
            for (const entity of [
                Library,
                GameExternalGame,
                GamePlatform,
                CollectionEntry,
                ImporterProcessedEntry,
                ImporterIgnoredEntry,
                ImporterNotifiedEntry,
                ImporterWatchNotification,
                Notification,
                UserConnection,
                PlayerConnectionSync,
                PlayerGameSync,
                UserPlaytime,
                UserPlaytimeHistory,
                PsnExtraMappings,
                ObtainedGameAchievement,
                ObtainedGameAchievementActivity,
                GameCompletionStatus,
                Activity,
            ]) {
                const metadata = source.getMetadata(entity);
                await runner.createTable(
                    Table.create(metadata, source.driver),
                    true,
                    false,
                );
                for (const relation of metadata.relations.filter(
                    (relation) => relation.isManyToManyOwner,
                )) {
                    if (
                        [
                            CollectionEntry,
                            ImporterWatchNotification,
                            ObtainedGameAchievementActivity,
                        ].includes(entity as any)
                    )
                        await runner.createTable(
                            Table.create(
                                relation.junctionEntityMetadata!,
                                source.driver,
                            ),
                            true,
                            false,
                        );
                }
            }
            await source
                .getRepository(GamePlatform)
                .insert({ id: 6, name: "PC", abbreviation: "PC" });
            await source.getRepository(GameExternalGame).insert(
                [1, 2].map((id) => ({
                    id,
                    gameId: id,
                    uid: String(id),
                    category: 1,
                })),
            );
        } finally {
            await runner.release();
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
    async function fixture() {
        const userId = randomUUID();
        await source.getRepository(Library).insert({ userId });
        const entries = source.getRepository(CollectionEntry);
        const collectionLookup = {
            findOneById: jest.fn().mockResolvedValue(null),
        };
        const collections = new CollectionsEntriesService(
            entries,
            {} as any,
            { register: jest.fn() } as any,
            { addTrackingJob: jest.fn() } as any,
            { registerLevelExpIncreaseActivity: jest.fn() } as any,
            collectionLookup as any,
            {} as any,
        );
        jest.spyOn(collections, "findOneByUserIdAndGameId").mockImplementation(
            (libraryUserId, gameId) =>
                entries.findOneBy({ libraryUserId, gameId }),
        );
        jest.spyOn(
            collections as any,
            "inferStatusAndAssociatedDates",
        ).mockResolvedValue({ status: "planned", plannedAt: new Date() });
        jest.spyOn(
            collections as any,
            "updateAssociatedCollections",
        ).mockResolvedValue(undefined);
        const connections = {
            findOneByUserIdAndTypeOrFail: jest
                .fn()
                .mockResolvedValue({ sourceUserId: "account" }),
            findOneByUserIdAndType: jest.fn().mockResolvedValue({
                isAutoImportEnabled: true,
                autoImportCollectionId: "deleted",
            }),
        };
        const importer = new ImporterService(
            source.getRepository(ImporterProcessedEntry),
            source.getRepository(ImporterIgnoredEntry),
            {} as any,
            connections as any,
            {
                getLibraryGames: jest
                    .fn()
                    .mockResolvedValue([1, 2].map((id) => ({ game: { id } }))),
            } as any,
            {
                getExternalGamesForSourceIds: jest.fn(async () =>
                    source.getRepository(GameExternalGame).find(),
                ),
            } as any,
            {} as any,
            {} as any,
            {} as any,
            new ConnectionProviderRegistry(),
        );
        const notifications = source.getRepository(ImporterWatchNotification);
        const registerImporterNotification = jest
            .fn()
            .mockResolvedValue({ id: "job" });
        const worker = new ImporterWatchProcessor(
            source.getRepository(ImporterNotifiedEntry),
            notifications,
            importer,
            { registerImporterNotification } as any,
            connections as any,
            collections,
        );
        return {
            userId,
            data: { userId, source: EImporterSource.STEAM },
            entries,
            collections,
            collectionLookup,
            importer,
            notifications,
            registerImporterNotification,
            worker,
            connections,
        };
    }
    it("migration preserves legacy notification/ignored decisions and starts recovery markers false", async () => {
        const migration = new RecoverImporterNotifications1792886400004();
        const runner = source.createQueryRunner();
        try {
            await migration.down(runner);
            await source.query(
                "INSERT INTO importer_notified_entry (libraryUserId, gameExternalGameId) VALUES ('legacy', 1)",
            );
            await source.query(
                "INSERT INTO importer_watch_notification (libraryUserId, source) VALUES ('legacy', 'steam')",
            );
            await migration.up(runner);
            expect(
                await source
                    .getRepository(ImporterNotifiedEntry)
                    .findOneByOrFail({ libraryUserId: "legacy" }),
            ).toMatchObject({ autoImportRetryable: false });
            expect(
                await source
                    .getRepository(ImporterWatchNotification)
                    .findOneByOrFail({ libraryUserId: "legacy" }),
            ).toMatchObject({ pendingDelivery: false });
            await migration.down(runner);
            await migration.up(runner);
        } finally {
            await runner.release();
        }
    });
    it("rolls back collection/status/notification state together if pending notification persistence fails", async () => {
        const f = await fixture();
        const save = jest
            .spyOn(f.notifications, "save")
            .mockRejectedValueOnce(
                new Error("injected notification commit failure"),
            );
        await expect(f.worker.run(f.data)).rejects.toThrow(
            "notification commit failure",
        );
        expect(await f.entries.countBy({ libraryUserId: f.userId })).toBe(0);
        expect(
            await source
                .getRepository(ImporterProcessedEntry)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
        expect(
            await source
                .getRepository(ImporterNotifiedEntry)
                .countBy({ libraryUserId: f.userId }),
        ).toBe(0);
        save.mockRestore();
        await f.worker.run(f.data);
        expect(await f.entries.countBy({ libraryUserId: f.userId })).toBe(2);
    });
    it("recovers a committed publication failure without recreating entries or resetting manual changes", async () => {
        const f = await fixture();
        f.registerImporterNotification.mockRejectedValueOnce(
            new Error("Redis unavailable"),
        );
        await expect(f.worker.run(f.data)).rejects.toThrow("Redis unavailable");
        const pending = await f.notifications.findOneByOrFail({
            libraryUserId: f.userId,
        });
        expect(pending).toMatchObject({
            autoImportedCount: 2,
            pendingDelivery: true,
        });
        await f.entries.update(
            { libraryUserId: f.userId },
            { isFavorite: true, status: CollectionEntryStatus.FINISHED },
        );
        await f.worker.run(f.data);
        expect(await f.entries.countBy({ libraryUserId: f.userId })).toBe(2);
        expect(
            (await f.entries.findBy({ libraryUserId: f.userId })).every(
                (row) => row.isFavorite && row.status === "finished",
            ),
        ).toBe(true);
        expect(await f.notifications.countBy({ libraryUserId: f.userId })).toBe(
            1,
        );
        expect(
            await f.notifications.findOneByOrFail({ id: pending.id }),
        ).toMatchObject({ pendingDelivery: false });
    });
    it("serializes concurrent import creation and completes an existing entry's missing processed transition", async () => {
        const f = await fixture();
        const outcomes = await Promise.all([
            f.collections.createForImport(f.userId, 1, 6),
            f.collections.createForImport(f.userId, 1, 6),
        ]);
        expect(outcomes.toSorted()).toEqual(["imported", "skipped"]);
        await f.entries.update(
            { libraryUserId: f.userId, gameId: 1 },
            { isFavorite: true },
        );
        await f.worker.run(f.data);
        expect(
            await f.entries.countBy({ libraryUserId: f.userId, gameId: 1 }),
        ).toBe(1);
        expect(
            await f.entries.findOneByOrFail({
                libraryUserId: f.userId,
                gameId: 1,
            }),
        ).toMatchObject({ isFavorite: true });
        expect(
            await source
                .getRepository(ImporterProcessedEntry)
                .existsBy({ libraryUserId: f.userId, gameExternalGameId: 1 }),
        ).toBe(true);
    });
    it("rejects another owner's destination and falls back safely after deletion", async () => {
        const f = await fixture();
        f.collectionLookup.findOneById.mockResolvedValueOnce({
            id: "foreign",
            libraryUserId: "other",
        } as any);
        await expect(
            f.collections.createForImport(f.userId, 1, 6, "foreign"),
        ).rejects.toMatchObject({ status: 403 });
        expect(await f.entries.countBy({ libraryUserId: f.userId })).toBe(0);
        await expect(
            f.collections.createForImport(f.userId, 1, 6, "deleted"),
        ).resolves.toBe("imported");
    });
    it("deduplicates downstream importer notification retries while preserving viewed state", async () => {
        const repository = source.getRepository(Notification);
        const service = new NotificationsService(repository, {} as any);
        const dto = {
            targetUserId: randomUUID(),
            userId: undefined,
            category: ENotificationCategory.WATCH,
            sourceType: NotificationSourceType.IMPORTER,
            sourceId: 1,
        };
        await Promise.all([service.create(dto), service.create(dto)]);
        expect(
            await repository.countBy({ targetProfileUserId: dto.targetUserId }),
        ).toBe(1);
        await repository.update(
            { targetProfileUserId: dto.targetUserId },
            { isViewed: true },
        );
        await service.create(dto);
        expect(
            await repository.findOneByOrFail({
                targetProfileUserId: dto.targetUserId,
            }),
        ).toMatchObject({ isViewed: true });
    });
    const redisIt = process.env.PLAYER_IMPORT_TEST_REDIS_PORT ? it : it.skip;
    redisIt(
        "coordinates full/manual/read races through real persistence, queues, and a second daily cycle",
        async () => {
            const f = await fixture();
            const connection = {
                host: "127.0.0.1",
                port: Number(process.env.PLAYER_IMPORT_TEST_REDIS_PORT),
                maxRetriesPerRequest: null,
            };
            const prefix = `player-acceptance-${randomUUID()}`;
            const queues = [
                PLAYER_DATA_QUEUE,
                GAME_ACHIEVEMENT_SYNC_QUEUE_NAME,
                "activities",
                NOTIFICATIONS_QUEUE_NAME,
            ].map(
                (name) =>
                    new Queue(name, {
                        connection,
                        prefix,
                        defaultJobOptions: {
                            removeOnComplete: { age: 3600, count: 1000 },
                        },
                    }),
            );
            const [fullQueue, gameQueue, activityQueue, notificationQueue] =
                queues;
            const runQueued = async (
                queue: Queue,
                handler: (job: any) => Promise<unknown>,
            ) => {
                const events = new QueueEvents(queue.name, {
                    connection,
                    prefix,
                });
                let worker: Worker | undefined;
                try {
                    await events.waitUntilReady();
                    const jobs = await queue.getWaiting();
                    worker = new Worker(queue.name, handler, {
                        connection,
                        prefix,
                    });
                    await Promise.all(
                        jobs.map((job) => job.waitUntilFinished(events, 10000)),
                    );
                } finally {
                    await worker?.close();
                    await events.close();
                }
            };
            try {
                const account = await source
                    .getRepository(UserConnection)
                    .save({
                        profileUserId: f.userId,
                        type: EConnectionType.STEAM,
                        sourceUserId: "account",
                        sourceUsername: "fixture",
                        isAutoImportEnabled: true,
                    });
                let clock = new Date();
                const a = new PlayerSyncStateService(source);
                const b = new PlayerSyncStateService(source);
                for (const state of [a, b])
                    jest.spyOn(state as any, "now").mockImplementation(
                        async () => new Date(clock),
                    );
                await a.initialize(account.id, "account", clock);
                const manual = new PlayerDataQueueService(fullQueue as any, a, {
                    get: () => "true",
                } as any);
                const scheduler = new PlayerDataQueueService(
                    fullQueue as any,
                    b,
                    { get: () => "true" } as any,
                );
                const gameAdmission = new GameAchievementSyncQueueService(
                    gameQueue,
                    b,
                );
                let minutes = 100;
                const owned = jest.fn(async () =>
                    [1, 2].map((id) => ({
                        game: { id },
                        minutes: id === 1 ? minutes : 100,
                        recentMinutes: 10,
                    })),
                );
                const recent = jest.fn().mockResolvedValue([]);
                const getUserAchievements = jest.fn().mockResolvedValue({
                    achievements: [
                        {
                            name: "award",
                            unlocked: true,
                            unlockedTimestamp: 1792886400,
                        },
                    ],
                });
                const steam = Object.assign(
                    Object.create(SteamSyncService.prototype),
                    {
                        getAllGames: owned,
                        getRecentlyPlayedGames: recent,
                        getUserAchievements,
                    },
                );
                const external = new ExternalGameService(
                    source.getRepository(GameExternalGame),
                    {} as any,
                );
                (f.importer as any).steamSyncService = steam;
                (f.importer as any).externalGameService = external;
                (f.worker as any).notificationsQueueService =
                    new NotificationsQueueService(notificationQueue);
                const playtime = new PlaytimeService(
                    source.getRepository(UserPlaytime),
                    new PlaytimeHistoryService(
                        source.getRepository(UserPlaytimeHistory),
                        {} as any,
                    ),
                );
                const playtimeWorker = new PlaytimeWatchProcessor(
                    playtime,
                    f.connections as any,
                    external,
                    {} as any,
                    steam,
                    {} as any,
                    {} as any,
                    {} as any,
                    {} as any,
                    gameAdmission,
                    new ConnectionProviderRegistry(),
                );
                const fullWorker = new PlayerDataProcessor(
                    a,
                    playtimeWorker,
                    f.worker,
                );
                const obtained = new GameObtainedAchievementService(
                    source.getRepository(ObtainedGameAchievement),
                    external,
                    steam,
                    {} as any,
                    {} as any,
                    f.connections as any,
                    gameAdmission,
                    new ConnectionProviderRegistry(),
                );
                const catalogue = {
                    findAllByExternalGameIdForSync: jest.fn(
                        async (id: number) => [
                            {
                                externalId: "award",
                                externalGameId: id,
                                gameId: id,
                                source: 1,
                            },
                        ],
                    ),
                    findAllByExternalGameId: jest.fn(async (id: number) => [
                        {
                            externalId: "award",
                            externalGameId: id,
                            gameId: id,
                            source: 1,
                        },
                    ]),
                };
                const localActivity = new GameAchievementActivityService(
                    source.getRepository(ObtainedGameAchievementActivity),
                    catalogue as any,
                    new ActivitiesQueueService(activityQueue),
                );
                const achievements = new GameAchievementSyncProcessor(
                    catalogue as any,
                    obtained,
                    localActivity,
                    new GameAchievementStatusService(
                        source.getRepository(GameCompletionStatus),
                    ),
                    b,
                    source,
                );
                const feed = new ActivitiesRepositoryService(
                    source.getRepository(Activity),
                    { createStatistics: jest.fn() } as any,
                    {} as any,
                    {} as any,
                    { isMature: jest.fn().mockResolvedValue(false) } as any,
                    {
                        checkIsSuspendedOrBanned: jest
                            .fn()
                            .mockResolvedValue(false),
                    } as any,
                    {} as any,
                    localActivity,
                );
                const notifications = new NotificationsService(
                    source.getRepository(Notification),
                    {} as any,
                );
                await Promise.all([
                    manual.request(f.userId, EConnectionType.STEAM),
                    scheduler.registerDueJobs(),
                    obtained.findAllObtainedByExternalGameId(
                        f.userId,
                        1,
                        f.userId,
                    ),
                ]);
                expect(await fullQueue.getWaitingCount()).toBe(1);
                await runQueued(fullQueue, (job) => fullWorker.process(job));
                expect(await gameQueue.getWaitingCount()).toBe(2);
                await runQueued(gameQueue, (job) => achievements.process(job));
                await runQueued(activityQueue, (job) => feed.create(job.data));
                await runQueued(notificationQueue, (job) =>
                    notifications.create(job.data),
                );
                expect(owned).toHaveBeenCalledTimes(1);
                expect(recent).toHaveBeenCalledTimes(1);
                expect(getUserAchievements).toHaveBeenCalledTimes(2);
                expect(
                    await source
                        .getRepository(ObtainedGameAchievement)
                        .countBy({ profileUserId: f.userId }),
                ).toBe(2);
                expect(
                    await source
                        .getRepository(Activity)
                        .countBy({ profileUserId: f.userId }),
                ).toBe(2);
                expect(
                    await source
                        .getRepository(Notification)
                        .countBy({ targetProfileUserId: f.userId }),
                ).toBe(1);
                expect(
                    await source
                        .getRepository(UserPlaytime)
                        .countBy({ profileUserId: f.userId }),
                ).toBe(2);
                expect(
                    await a.status(f.userId, EConnectionType.STEAM),
                ).toMatchObject({ status: "cooldown" });
                const firstId = (await fullQueue.getCompleted())[0].id;
                const restarted = new PlayerDataQueueService(
                    fullQueue as any,
                    b,
                    { get: () => "true" } as any,
                );
                await restarted.onModuleInit();
                clock = new Date(clock.getTime() + 86400000 - 1);
                expect(
                    await restarted.request(f.userId, EConnectionType.STEAM),
                ).toMatchObject({ status: "cooldown" });
                clock = new Date(clock.getTime() + 1);
                minutes = 101;
                await restarted.request(f.userId, EConnectionType.STEAM);
                expect((await fullQueue.getWaiting())[0].id).not.toBe(firstId);
                await runQueued(fullQueue, (job) => fullWorker.process(job));
                expect(await gameQueue.getWaitingCount()).toBe(1);
                await runQueued(gameQueue, (job) => achievements.process(job));
                expect(await activityQueue.getWaitingCount()).toBe(0);
                expect(await notificationQueue.getWaitingCount()).toBe(0);
                expect(getUserAchievements).toHaveBeenCalledTimes(3);
                expect(
                    await source
                        .getRepository(ObtainedGameAchievement)
                        .countBy({ profileUserId: f.userId }),
                ).toBe(2);
                expect(
                    await source
                        .getRepository(Activity)
                        .countBy({ profileUserId: f.userId }),
                ).toBe(2);
                expect(
                    await source
                        .getRepository(Notification)
                        .countBy({ targetProfileUserId: f.userId }),
                ).toBe(1);
                expect(
                    (
                        await source
                            .getRepository(UserPlaytime)
                            .findOneByOrFail({
                                profileUserId: f.userId,
                                gameId: 1,
                            })
                    ).totalPlaytimeSeconds,
                ).toBe(6060);
            } finally {
                for (const queue of queues) {
                    await queue.obliterate({ force: true });
                    await queue.close();
                }
            }
        },
        60000,
    );
});
