import { Processor } from "@nestjs/bullmq";
import {
    IMPORTER_WATCH_JOB_NAME,
    IMPORTER_WATCH_QUEUE_NAME,
    ImporterWatchAutoImportStats,
    ImporterWatchJob,
} from "./importer-watch.constants";
import { seconds } from "@nestjs/throttler";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { InjectRepository } from "@nestjs/typeorm";
import { ImporterNotifiedEntry } from "../entity/importer-notified-entry.entity";
import { Repository } from "typeorm";
import { ImporterWatchNotification } from "../entity/importer-notification.entity";
import { ImporterService } from "../importer.service";
import { NotificationsQueueService } from "../../notifications/notifications-queue.service";
import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
import { EImporterSource } from "../importer.constants";
import {
    ENotificationCategory,
    NotificationSourceType,
} from "../../notifications/notifications.constants";
import { ConnectionsService } from "../../connection/connections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { importerToConnectionSource } from "../importer.util";
import { ImporterResponseItemDto } from "../dto/importer-response-item.dto";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";

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

    async process(job: Job<ImporterWatchJob>) {
        if (job.name === IMPORTER_WATCH_JOB_NAME) {
            return this.findUnprocessedEntries(job.data);
        }
    }

    private async findUnprocessedEntries(data: ImporterWatchJob) {
        this.logger.log(
            `Started importer update for ${data.userId} in source ${data.source}`,
        );
        const [unprocessedGames] =
            await this.importerService.findUnprocessedEntries(
                data.userId,
                data.source,
                {
                    offset: 0,
                    limit: 9999999,
                },
            );

        if (unprocessedGames.length === 0) {
            this.logger.log(
                `No unprocessed entries found for userId: ${data.userId} on source ${data.source}`,
            );
            return;
        }

        const notifiedEntries =
            await this.importerNotifiedEntryRepository.findBy({
                libraryUserId: data.userId,
            });

        const notAlreadyNotifiedGames = unprocessedGames.filter(
            (externalGame) => {
                const alreadyNotified = notifiedEntries.some(
                    (notifiedEntry) => {
                        return (
                            notifiedEntry.gameExternalGameId === externalGame.id
                        );
                    },
                );
                return !alreadyNotified;
            },
        );

        if (notAlreadyNotifiedGames.length === 0) {
            this.logger.log(
                `Skipping notifying user ${data.userId} because all games in source ${data.source} have already been used in notifications.`,
            );
            return;
        }

        const autoImportStats = await this.handleAutoImport(
            data.userId,
            data.source,
            notAlreadyNotifiedGames,
        );

        await this.createNotification(
            data.userId,
            notAlreadyNotifiedGames,
            data.source,
            autoImportStats,
        );
    }

    private async createNotification(
        userId: string,
        externalGames: GameExternalGame[],
        source: EImporterSource,
        autoImportStats: ImporterWatchAutoImportStats,
    ) {
        const notification = await this.importerNotificationRepository.save({
            libraryUserId: userId,
            games: externalGames,
            source,
            autoImportedCount: autoImportStats.imported,
            autoImportSkippedCount: autoImportStats.skipped,
        });

        this.notificationsQueueService.registerNotification({
            targetUserId: userId,
            category: ENotificationCategory.WATCH,
            sourceType: NotificationSourceType.IMPORTER,
            userId: undefined,
            sourceId: notification.id,
        });

        for (const externalGame of externalGames) {
            await this.importerNotifiedEntryRepository.save({
                libraryUserId: userId,
                gameExternalGameId: externalGame.id,
            });
        }
    }

    private async handleAutoImport(
        userId: string,
        source: EImporterSource,
        externalGameDtos: ImporterResponseItemDto[],
    ): Promise<ImporterWatchAutoImportStats> {
        let importedCount = 0;
        let skippedCount = 0;

        try {
            const connectionType = importerToConnectionSource(source);
            const connection =
                await this.connectionsService.findOneByUserIdAndType(
                    userId,
                    connectionType,
                );

            if (!connection || !connection.isAutoImportEnabled) {
                return { imported: 0, skipped: 0 };
            }

            this.logger.log(
                `Starting auto-import for user ${userId} on source ${source} with ${externalGameDtos.length} games`,
            );

            // If autoImportCollectionId is set, use it; otherwise use empty array
            const collectionIds = connection.autoImportCollectionId
                ? [connection.autoImportCollectionId]
                : [];

            for (const externalGame of externalGameDtos) {
                try {
                    // Check if the game already exists in the user's library
                    const existingEntry =
                        await this.collectionsEntriesService.findOneByUserIdAndGameId(
                            userId,
                            externalGame.gameId,
                        );

                    if (existingEntry) {
                        this.logger.log(
                            `Skipping auto-import of game ${externalGame.gameId} for user ${userId} - already in library`,
                        );
                        skippedCount++;
                        continue;
                    }

                    await this.collectionsEntriesService.createOrUpdate(
                        userId,
                        {
                            collectionIds,
                            gameId: externalGame.gameId,
                            platformIds: [externalGame.preferredPlatformId],
                            status: CollectionEntryStatus.PLANNED,
                            finishedAt: null,
                        },
                    );

                    await this.importerService.changeStatus(userId, {
                        externalGameId: externalGame.id,
                        status: "processed",
                    });

                    importedCount++;
                    this.logger.log(
                        `Auto-imported game ${externalGame.gameId} for user ${userId}`,
                    );
                } catch (error) {
                    this.logger.error(
                        `Failed to auto-import game ${externalGame.gameId} for user ${userId}: ${error.message}`,
                        error.stack,
                    );
                }
            }

            this.logger.log(
                `Completed auto-import for user ${userId} on source ${source}: ${importedCount} imported, ${skippedCount} skipped`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to handle auto-import for user ${userId} on source ${source}: ${error.message}`,
                error.stack,
            );
        }

        return { imported: importedCount, skipped: skippedCount };
    }
}
