import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { Interval } from "@nestjs/schedule";
import { ConnectionsService } from "../../connections/connections.service";
import { hours } from "@nestjs/throttler";
import {
    PLAYTIME_WATCH_QUEUE_JOB_NAME,
    PLAYTIME_WATCH_QUEUE_NAME,
    PlaytimeWatchJob,
} from "./playtime-watch.constants";
import { LibrariesService } from "../../libraries/libraries.service";
import { connectionToPlaytimeSource } from "../playtime.util";
import { EConnectionType } from "../../connections/connections.constants";

@Injectable()
export class PlaytimeWatchService {
    private readonly logger = new Logger(PlaytimeWatchService.name);

    constructor(
        @InjectQueue(PLAYTIME_WATCH_QUEUE_NAME)
        private readonly playtimeWatchQueue: Queue<PlaytimeWatchJob>,
        private readonly librariesService: LibrariesService,
        @Inject(forwardRef(() => ConnectionsService))
        private readonly connectionsService: ConnectionsService,
    ) {
        this.registerWatchJobs();
    }

    @Interval(hours(6))
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
            const source = connectionToPlaytimeSource(viableConnection.type);
            this.playtimeWatchQueue
                .add(
                    PLAYTIME_WATCH_QUEUE_JOB_NAME,
                    {
                        userId: viableConnection.profileUserId,
                        source: source,
                    },
                    {
                        jobId: `playtime-watch-${viableConnection.profileUserId}-${source}`,
                    },
                )
                .catch((err) => {
                    this.logger.error(err);
                });
        }
    }

    async registerManualJob(userId: string, source: EConnectionType) {
        const playtimeSource = connectionToPlaytimeSource(source);

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
