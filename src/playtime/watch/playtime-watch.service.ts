import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { Cron } from "@nestjs/schedule";
import { ConnectionsService } from "../../connection/connections.service";
import {
    PLAYTIME_WATCH_QUEUE_JOB_NAME,
    PLAYTIME_WATCH_QUEUE_NAME,
    PlaytimeWatchJob,
} from "./playtime-watch.constants";
import { LibrariesService } from "../../libraries/libraries.service";
import { connectionToPlaytimeImportSource } from "../playtime.util";
import { EConnectionType } from "../../connection/connections.constants";

@Injectable()
export class PlaytimeWatchService {
    private readonly logger = new Logger(PlaytimeWatchService.name);

    constructor(
        @InjectQueue(PLAYTIME_WATCH_QUEUE_NAME)
        private readonly playtimeWatchQueue: Queue<PlaytimeWatchJob>,
        private readonly librariesService: LibrariesService,
        @Inject(forwardRef(() => ConnectionsService))
        private readonly connectionsService: ConnectionsService,
    ) {}

    // “At minute 0 past hour 6, 12, 18, and 0.”
    @Cron("0 6,12,18,0 * * *")
    async registerWatchJobs() {
        const userLibraries = await this.librariesService.findAllLibraries();
        const userIds = userLibraries.map((library) => library.userId);

        const availableConnections =
            await this.connectionsService.findAllByUserIdIn(userIds);

        const viableConnections = availableConnections.filter(
            (connection) =>
                connection.isPlaytimeImportViable &&
                connection.isPlaytimeImportEnabled,
        );

        if (viableConnections.length === 0) {
            this.logger.error("No viable user connections found. Aborting.");
            return;
        }

        for (const viableConnection of viableConnections) {
            await this.registerJob(
                viableConnection.profileUserId,
                viableConnection.type,
            );
        }
    }

    async registerJob(userId: string, source: EConnectionType) {
        const playtimeSource = connectionToPlaytimeImportSource(source);

        this.playtimeWatchQueue
            .add(
                PLAYTIME_WATCH_QUEUE_JOB_NAME,
                {
                    userId: userId,
                    source: playtimeSource,
                },
                {
                    jobId: `playtime-watch-${userId}-${source}`,
                },
            )
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
