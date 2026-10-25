import { Cron } from "@nestjs/schedule";
import { Transactional } from "typeorm-transactional";
import {
    PlayerSyncWrite,
    recordPlayerSyncStats,
} from "../../sync/player-sync-attempt";
import { assertPlayerSyncActive } from "../../sync/player-sync-attempt";
import { Processor } from "@nestjs/bullmq";
import {
    IMPORTER_WATCH_JOB_NAME,
    IMPORTER_WATCH_QUEUE_NAME,
    ImporterWatchJob,
} from "./importer-watch.constants";
import { seconds } from "@nestjs/throttler";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { ImporterNotifiedEntry } from "../entity/importer-notified-entry.entity";
import { In, Repository } from "typeorm";
import { ImporterWatchNotification } from "../entity/importer-notification.entity";
import { ImporterService } from "../importer.service";
import { NotificationsQueueService } from "../../notifications/notifications-queue.service";
import { EImporterSource } from "../importer.constants";
import {
    ENotificationCategory,
    NotificationSourceType,
} from "../../notifications/notifications.constants";
import { ConnectionsService } from "../../connection/connections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { importerToConnectionSource } from "../importer.util";
import { ImporterResponseItemDto } from "../dto/importer-response-item.dto";

@Processor(IMPORTER_WATCH_QUEUE_NAME, {
    limiter: {
        max: 1,
        duration: seconds(2),
    },
})
export class ImporterWatchProcessor extends WorkerHostProcessor {
    logger = new Logger(ImporterWatchProcessor.name);

    constructor(
        @InjectRepository(ImporterNotifiedEntry)
        private readonly importerNotifiedEntryRepository: Repository<ImporterNotifiedEntry>,
        @InjectRepository(ImporterWatchNotification)
        private readonly importerNotificationRepository: Repository<ImporterWatchNotification>,
        private readonly importerService: ImporterService,
        private readonly notificationsQueueService: NotificationsQueueService,
        private readonly connectionsService: ConnectionsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
    ) {
        super();
    }

    async process(_job: Job) {
        return { outcome: "legacy-skip" };
    }

    public async run(data: ImporterWatchJob) {
        let cursor = 0;
        let seen = 0;
        let worked = false;
        let failed = 0;
        await this.recoverPendingNotifications();
        while (true) {
            const [games] = await this.importerService.findUnprocessedEntries(
                data.userId,
                data.source,
                { offset: 0, limit: 100 },
                cursor,
            );
            if (!games.length) break;
            seen += games.length;
            recordPlayerSyncStats({ gamesSeen: seen });
            const result = await this.commitPage(data, games);
            worked ||= result.worked;
            failed += result.stats.failed;
            recordPlayerSyncStats({
                imported: result.stats.imported,
                skippedImports: result.stats.skipped,
                failedImports: result.stats.failed,
            });
            if (result.notification)
                await this.deliverNotification(result.notification);
            cursor = games[games.length - 1].gameId;
        }
        if (failed) throw new Error(`${failed} automatic imports failed`);
        return worked ? ("complete" as const) : ("empty" as const);
    }

    @PlayerSyncWrite()
    @Transactional()
    private async commitPage(
        data: ImporterWatchJob,
        games: ImporterResponseItemDto[],
    ) {
        const notified = await this.importerNotifiedEntryRepository.findBy({
            libraryUserId: data.userId,
            gameExternalGameId: In(games.map((game) => game.id)),
        });
        const notifiedById = new Map(
            notified.map((entry) => [entry.gameExternalGameId, entry]),
        );
        const eligible = games.filter(
            (game) =>
                !notifiedById.has(game.id) ||
                notifiedById.get(game.id)!.autoImportRetryable,
        );
        const outcomes = new Map<number, "imported" | "skipped" | "failed">();
        const connection = await this.connectionsService.findOneByUserIdAndType(
            data.userId,
            importerToConnectionSource(data.source),
        );
        if (connection?.isAutoImportEnabled) {
            for (const game of eligible) {
                assertPlayerSyncActive();
                try {
                    if (
                        await this.importerService.isProcessedOrIgnored(
                            data.userId,
                            game.id,
                        )
                    ) {
                        outcomes.set(game.id, "skipped");
                    } else {
                        const outcome =
                            await this.collectionsEntriesService.createForImport(
                                data.userId,
                                game.gameId,
                                game.preferredPlatformId,
                                connection.autoImportCollectionId,
                            );
                        await this.importerService.markProcessed(
                            data.userId,
                            game.id,
                        );
                        outcomes.set(game.id, outcome);
                    }
                } catch {
                    outcomes.set(game.id, "failed");
                    this.logger.warn({
                        event: "automatic-import-failed",
                        source: data.source,
                    });
                }
            }
        }
        const stats = { imported: 0, skipped: 0, failed: 0 };
        for (const outcome of outcomes.values()) stats[outcome]++;
        for (const game of eligible) {
            await this.importerNotifiedEntryRepository.upsert(
                {
                    libraryUserId: data.userId,
                    gameExternalGameId: game.id,
                    autoImportRetryable: outcomes.get(game.id) === "failed",
                },
                ["libraryUserId", "gameExternalGameId"],
            );
        }
        const newGames = games.filter((game) => !notifiedById.has(game.id));
        const newOutcomes = newGames.map((game) => outcomes.get(game.id));
        const notification = newGames.length
            ? await this.importerNotificationRepository.save({
                  libraryUserId: data.userId,
                  games: newGames,
                  source: data.source,
                  autoImportedCount: newOutcomes.filter(
                      (outcome) => outcome === "imported",
                  ).length,
                  autoImportSkippedCount: newOutcomes.filter(
                      (outcome) => outcome === "skipped",
                  ).length,
                  autoImportFailedCount: newOutcomes.filter(
                      (outcome) => outcome === "failed",
                  ).length,
                  pendingDelivery: true,
              })
            : null;
        return {
            notification,
            stats,
            worked: !!notification || outcomes.size > 0,
        };
    }

    private async deliverNotification(notification: ImporterWatchNotification) {
        await this.notificationsQueueService.registerImporterNotification({
            targetUserId: notification.libraryUserId,
            category: ENotificationCategory.WATCH,
            sourceType: NotificationSourceType.IMPORTER,
            userId: undefined,
            sourceId: notification.id,
        });
        await this.importerNotificationRepository.update(
            { id: notification.id, pendingDelivery: true },
            { pendingDelivery: false },
        );
    }

    @Cron("*/5 * * * *")
    public async recoverPendingNotifications() {
        const pending = await this.importerNotificationRepository.find({
            where: { pendingDelivery: true },
            order: { id: "ASC" },
            take: 100,
        });
        for (const notification of pending) {
            try {
                await this.deliverNotification(notification);
            } catch {
                this.logger.warn({
                    event: "importer-notification-delivery-failed",
                    source: notification.source,
                });
            }
        }
    }
}
