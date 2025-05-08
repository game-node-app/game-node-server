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

        await this.createNotification(
            data.userId,
            notAlreadyNotifiedGames,
            data.source,
        );
    }

    private async createNotification(
        userId: string,
        externalGames: GameExternalGame[],
        source: EImporterSource,
    ) {
        const notification = await this.importerNotificationRepository.save({
            libraryUserId: userId,
            games: externalGames,
            source,
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
}
