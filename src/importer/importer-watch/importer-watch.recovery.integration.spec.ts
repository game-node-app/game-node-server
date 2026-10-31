import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { testEnvironment } from "../../../test/igdb/helpers/test-environment";
import { NotificationOutbox } from "../../notifications/entity/notification-outbox.entity";
import { NotificationsRelayService } from "../../notifications/notifications-relay.service";
import { NotificationsProjectorService } from "../../notifications/notifications-projector.service";
import * as outboxModule from "../../notifications/notifications-outbox.service";
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
import { NOTIFICATIONS_QUEUE_NAME } from "../../notifications/notifications.constants";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DataSource, In } from "typeorm";
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
import { NotificationInbox } from "../../notifications/entity/notification-inbox.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { NotificationsService } from "../../notifications/notifications.service";
import { EImporterSource } from "../importer.constants";

describe("import and notification recovery on disposable MySQL", () => {
    let source: DataSource;
    beforeAll(async () => {
        initializeTransactionalContext({
            storageDriver: StorageDriver.ASYNC_LOCAL_STORAGE,
        });
        source = await createNotificationTestDataSource();
        addTransactionalDataSource(source);
        await source.query(
            "INSERT IGNORE INTO game (id, name, slug) VALUES (2, 'Importer fixture 2', 'importer-fixture-2')",
        );
        await source
            .getRepository(GamePlatform)
            .upsert({ id: 6, name: "PC", abbreviation: "PC" }, ["id"]);
        await source.getRepository(GameExternalGame).upsert(
            [1, 2].map((id) => ({
                id,
                gameId: id,
                uid: String(id),
                category: 1,
            })),
            ["id"],
        );
    }, 120000);
    afterAll(async () => {
        deleteDataSourceByName("default");
        if (source?.isInitialized) await source.destroy();
    });
    async function fixture() {
        const userId = randomUUID();
        await source
            .getRepository(Profile)
            .insert({ userId, username: `im_${userId.slice(0, 12)}` });
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
                    source
                        .getRepository(GameExternalGame)
                        .findBy({ id: In([1, 2]) }),
                ),
            } as any,
            {} as any,
            {} as any,
            {} as any,
            new ConnectionProviderRegistry(),
            {} as any,
            {} as any,
        );
        const notifications = source.getRepository(ImporterWatchNotification);
        const worker = new ImporterWatchProcessor(
            source.getRepository(ImporterNotifiedEntry),
            notifications,
            importer,
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
            worker,
            connections,
        };
    }
    it("rolls back imports and choices when transactional outbox append fails", async () => {
        const f = await fixture();
        const failure = jest
            .spyOn(outboxModule, "appendNotificationIntent")
            .mockRejectedValueOnce(new Error("outbox unavailable"));
        try {
            await expect(f.worker.run(f.data)).rejects.toThrow(
                "outbox unavailable",
            );
        } finally {
            failure.mockRestore();
        }
        for (const entity of [
            CollectionEntry,
            ImporterProcessedEntry,
            ImporterNotifiedEntry,
            ImporterWatchNotification,
        ]) {
            expect(
                await source
                    .getRepository(entity)
                    .countBy({ libraryUserId: f.userId }),
            ).toBe(0);
        }
        expect(
            await source
                .getRepository(NotificationOutbox)
                .countBy({ recipientUserId: f.userId }),
        ).toBe(0);
        await expect(f.worker.run(f.data)).resolves.toBe("complete");
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
    it("recovers committed notification transport failure without repeating imports or resetting manual choices", async () => {
        const f = await fixture();
        await expect(f.worker.run(f.data)).resolves.toBe("complete");
        const repository = source.getRepository(NotificationOutbox);
        const event = await repository.findOneByOrFail({
            recipientUserId: f.userId,
        });
        expect(event.payload).toMatchObject({
            gameCount: 2,
            importedCount: 2,
            skippedCount: 0,
            failedCount: 0,
        });
        const relay = new NotificationsRelayService(source, repository, {
            add: jest.fn().mockRejectedValue(new Error("Redis unavailable")),
        } as any);
        await repository.update(
            { id: event.id },
            {
                state: "processing",
                attempts: 1,
                ownerToken: "transport-down",
                ownerExpiresAt: new Date(Date.now() + 30000),
            },
        );
        await relay.publishClaimedRows([
            await repository.findOneByOrFail({ id: event.id }),
        ]);
        expect(
            await repository.findOneByOrFail({ id: event.id }),
        ).toMatchObject({
            state: "pending",
            lastError: "transport_unavailable",
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
        expect(await repository.countBy({ recipientUserId: f.userId })).toBe(1);
        await repository.update(
            { id: event.id },
            {
                state: "processing",
                ownerToken: "recovery",
                ownerExpiresAt: new Date(Date.now() + 30000),
            },
        );
        expect(
            await new NotificationsProjectorService(source, relay).projectEvent(
                event.id,
                "recovery",
            ),
        ).toBe(true);
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
    it("deduplicates importer projection and preserves acknowledged versions", async () => {
        const f = await fixture();
        await f.worker.run(f.data);
        const repository = source.getRepository(NotificationOutbox);
        const event = await repository.findOneByOrFail({
            recipientUserId: f.userId,
        });
        const relay = new NotificationsRelayService(
            source,
            repository,
            {} as any,
        );
        const projector = new NotificationsProjectorService(source, relay);
        for (const token of ["first", "duplicate"]) {
            await repository.update(
                { id: event.id },
                {
                    state: "processing",
                    ownerToken: token,
                    ownerExpiresAt: new Date(Date.now() + 30000),
                },
            );
            expect(await projector.projectEvent(event.id, token)).toBe(true);
            const inbox = await source
                .getRepository(NotificationInbox)
                .findOneByOrFail({ recipientUserId: f.userId });
            expect(inbox.eventCount).toBe(1);
            if (token === "first")
                await source
                    .getRepository(NotificationInbox)
                    .update(inbox.id, { readVersion: 1 });
            else expect(inbox.readVersion).toBe(1);
        }
    });

    it("retains mixed import retry state and ignored/manual choices independently of notification recovery", async () => {
        const f = await fixture();
        const failed = jest
            .spyOn(f.collections, "createForImport")
            .mockRejectedValueOnce(new Error("temporary import failure"));
        await expect(f.worker.run(f.data)).rejects.toThrow(
            "1 automatic imports failed",
        );
        failed.mockRestore();
        const retry = await source
            .getRepository(ImporterNotifiedEntry)
            .findOneByOrFail({
                libraryUserId: f.userId,
                autoImportRetryable: true,
            });
        const event = await source
            .getRepository(NotificationOutbox)
            .findOneByOrFail({ recipientUserId: f.userId });
        expect(event.payload).toMatchObject({
            gameCount: 2,
            importedCount: 1,
            skippedCount: 0,
            failedCount: 1,
        });
        await f.entries.update(
            { libraryUserId: f.userId },
            { isFavorite: true },
        );
        await f.worker.run(f.data);
        expect(await f.entries.countBy({ libraryUserId: f.userId })).toBe(2);
        expect(
            await source
                .getRepository(ImporterNotifiedEntry)
                .findOneByOrFail({ id: retry.id }),
        ).toMatchObject({ autoImportRetryable: false });
        expect(await f.notifications.countBy({ libraryUserId: f.userId })).toBe(
            1,
        );
        expect(
            await source
                .getRepository(NotificationOutbox)
                .countBy({ recipientUserId: f.userId }),
        ).toBe(1);
        expect(
            await f.entries.countBy({
                libraryUserId: f.userId,
                isFavorite: true,
            }),
        ).toBe(1);
        const ignored = await fixture();
        await source
            .getRepository(ImporterIgnoredEntry)
            .insert({ libraryUserId: ignored.userId, gameExternalGameId: 1 });
        await ignored.worker.run(ignored.data);
        expect(
            await source
                .getRepository(ImporterIgnoredEntry)
                .countBy({ libraryUserId: ignored.userId }),
        ).toBe(1);
        expect(
            await ignored.entries.countBy({ libraryUserId: ignored.userId }),
        ).toBe(1);
    });
    it("coordinates full/manual/read races through real persistence, queues, and a second daily cycle", async () => {
        const f = await fixture();
        const connection = {
            ...testEnvironment(process.env).redis,
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
        const [fullQueue, gameQueue, activityQueue, notificationQueue] = queues;
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
            const account = await source.getRepository(UserConnection).save({
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
            const scheduler = new PlayerDataQueueService(fullQueue as any, b, {
                get: () => "true",
            } as any);
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
                findAllByExternalGameIdForSync: jest.fn(async (id: number) => [
                    {
                        externalId: "award",
                        externalGameId: id,
                        gameId: id,
                        source: 1,
                    },
                ]),
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
                {} as any,
                {} as any,
                { isMature: jest.fn().mockResolvedValue(false) } as any,
                { getLockoutStates: jest.fn().mockResolvedValue(new Map()) } as any,
                {} as any,
                localActivity,
            );
            const notifications = new NotificationsService(
                source.getRepository(NotificationInbox),
                source.getRepository(Profile),
                source,
            );
            await Promise.all([
                manual.request(f.userId, EConnectionType.STEAM),
                scheduler.registerDueJobs(),
                obtained.findAllObtainedByExternalGameId(f.userId, 1, f.userId),
            ]);
            expect(await fullQueue.getWaitingCount()).toBe(1);
            await runQueued(fullQueue, (job) => fullWorker.process(job));
            expect(await gameQueue.getWaitingCount()).toBe(2);
            await runQueued(gameQueue, (job) => achievements.process(job));
            await runQueued(activityQueue, (job) => feed.create(job.data));
            const relay = new NotificationsRelayService(
                source,
                source.getRepository(NotificationOutbox),
                notificationQueue,
            );
            const projector = new NotificationsProjectorService(source, relay);
            const event = await source
                .getRepository(NotificationOutbox)
                .findOneByOrFail({
                    recipientUserId: f.userId,
                    state: "pending",
                });
            await source
                .getRepository(NotificationOutbox)
                .update(event.id, { nextAttemptAt: new Date("2000-01-01") });
            const claimed = await relay.claimDueRows(1);
            expect(claimed[0].id).toBe(event.id);
            await relay.publishClaimedRows(claimed);
            await runQueued(notificationQueue, (job) =>
                projector.projectEvent(job.data.eventId, job.data.attemptToken),
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
                    .getRepository(NotificationInbox)
                    .countBy({ recipientUserId: f.userId }),
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
            const restarted = new PlayerDataQueueService(fullQueue as any, b, {
                get: () => "true",
            } as any);
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
                    .getRepository(NotificationInbox)
                    .countBy({ recipientUserId: f.userId }),
            ).toBe(1);
            expect(
                (
                    await source.getRepository(UserPlaytime).findOneByOrFail({
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
    }, 60000);
});
