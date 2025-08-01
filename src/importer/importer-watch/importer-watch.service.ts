import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ConnectionsService } from "../../connection/connections.service";
import { LibrariesService } from "../../libraries/libraries.service";
import { IMPORTER_WATCH_VIABLE_CONNECTIONS } from "../../connection/connections.constants";
import { ImporterWatchNotification } from "../entity/importer-notification.entity";
import { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import {
    IMPORTER_WATCH_JOB_NAME,
    IMPORTER_WATCH_QUEUE_NAME,
    ImporterWatchJob,
} from "./importer-watch.constants";
import { connectionToImporterSource } from "../importer.util";
import { Interval } from "@nestjs/schedule";
import { hours } from "@nestjs/throttler";

@Injectable()
export class ImporterWatchService {
    private readonly logger = new Logger(ImporterWatchService.name);

    constructor(
        @InjectQueue(IMPORTER_WATCH_QUEUE_NAME)
        private readonly queue: Queue<ImporterWatchJob>,
        @InjectRepository(ImporterWatchNotification)
        private readonly importerNotificationRepository: Repository<ImporterWatchNotification>,
        private readonly connectionsService: ConnectionsService,
        private readonly librariesService: LibrariesService,
    ) {
        this.registerWatchJobs();
    }

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

    /**
     * Checks for new importable entries from users with valid connections
     */
    @Interval(hours(24))
    public async registerWatchJobs() {
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
            const source = connectionToImporterSource(connection.type);

            this.queue
                .add(
                    IMPORTER_WATCH_JOB_NAME,
                    {
                        userId: connection.profileUserId,
                        source: source,
                    },
                    {
                        jobId: `importer-watch-${connection.profileUserId}-${source}`,
                    },
                )
                .catch((err) => {
                    this.logger.error(err);
                });
        }
    }
}
