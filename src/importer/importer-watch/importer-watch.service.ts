import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ImporterNotifiedEntry } from "../entity/importer-notified-entry.entity";
import { Repository } from "typeorm";
import { ImporterService } from "../importer.service";
import { Interval, Timeout } from "@nestjs/schedule";
import { hours, seconds } from "@nestjs/throttler";
import { ConnectionsService } from "../../connections/connections.service";
import { LibrariesService } from "../../libraries/libraries.service";
import {
    EConnectionType,
    IMPORTER_WATCH_VIABLE_CONNECTIONS,
} from "../../connections/connections.constants";
import { GameExternalGame } from "../../game/game-repository/entities/game-external-game.entity";
import { EImporterSource } from "../importer.constants";
import { ImporterWatchNotification } from "../entity/importer-notification.entity";
import { NotificationsQueueService } from "../../notifications/notifications-queue.service";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../../notifications/notifications.constants";
import { UserConnectionDto } from "../../connections/dto/user-connection.dto";

@Injectable()
export class ImporterWatchService {
    private readonly logger = new Logger(ImporterWatchService.name);

    constructor(
        @InjectRepository(ImporterNotifiedEntry)
        private readonly importerNotifiedEntryRepository: Repository<ImporterNotifiedEntry>,
        @InjectRepository(ImporterWatchNotification)
        private readonly importerNotificationRepository: Repository<ImporterWatchNotification>,
        private readonly importerService: ImporterService,
        private readonly connectionsService: ConnectionsService,
        private readonly librariesService: LibrariesService,
        private readonly notificationsQueueService: NotificationsQueueService,
    ) {}

    public async findNotification(userId: string, notificationId: number) {
        return this.importerNotificationRepository.findOneOrFail({
            where: {
                libraryUserId: userId,
                id: notificationId,
            },
            relations: {
                games: true,
            },
        });
    }

    @Timeout(seconds(60))
    onStartup() {
        this.process();
    }

    /**
     * Checks for new importable entries from users with valid connections
     */
    @Interval(hours(6))
    public async process() {
        this.logger.log(`Starting processing job`);
        const libraries = await this.librariesService.findAllLibraries();
        const userIds = libraries.map((library) => library.userId);
        const connections =
            await this.connectionsService.findAllByUserIdIn(userIds);

        if (connections.length === 0) {
            this.logger.log(
                `Skipping processing because no suitable user connection was found`,
            );
            return;
        }

        const usableConnections = connections.filter(
            (connection) =>
                IMPORTER_WATCH_VIABLE_CONNECTIONS.includes(connection.type) &&
                connection.isImporterEnabled,
        );

        for (const connection of usableConnections) {
            this.findUnprocessedEntries(connection)
                .then()
                .catch((err) => {
                    this.logger.error(err);
                });
        }
    }

    private async findUnprocessedEntries(userConnection: UserConnectionDto) {
        let unprocessedGames: GameExternalGame[] = [];
        switch (userConnection.type) {
            case EConnectionType.STEAM:
                [unprocessedGames] =
                    await this.importerService.findUnprocessedEntries(
                        userConnection.profileUserId,
                        EImporterSource.STEAM,
                        {
                            offset: 0,
                            limit: 99999,
                        },
                    );
                break;
        }
        if (unprocessedGames.length === 0) {
            this.logger.log(
                `No unprocessed entries found for userId: ${userConnection.profileUserId} on source ${userConnection.type}`,
            );
            return;
        }
        const notifiedEntries =
            await this.importerNotifiedEntryRepository.findBy({
                libraryUserId: userConnection.profileUserId,
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
                `Skipping notifying user ${userConnection.profileUserId} because all games in source ${userConnection.type} have already been used in notifications.`,
            );
            return;
        }

        await this.createNotification(
            userConnection.profileUserId,
            notAlreadyNotifiedGames,
        );
    }

    private async createNotification(
        userId: string,
        externalGames: GameExternalGame[],
    ) {
        const notification = await this.importerNotificationRepository.save({
            libraryUserId: userId,
            games: externalGames,
            source: EImporterSource.STEAM,
        });

        this.notificationsQueueService.registerNotification({
            targetUserId: userId,
            category: ENotificationCategory.WATCH,
            sourceType: ENotificationSourceType.IMPORTER,
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
