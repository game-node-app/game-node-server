import { InjectQueue, Processor } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import {
    IGDB_SYNC_FETCH_JOB_NAME,
    IGDB_SYNC_JOB_NAME,
    IGDB_SYNC_QUEUE_NAME,
} from "./igdb-sync.constants";
import isEmptyObject from "../../utils/isEmptyObject";
import {
    objectKeysToCamelCase,
    parseGameDates,
} from "./utils/game-conversor-utils";

import { PartialGame } from "../../game/game-repository/game-repository.types";
import { GameRepositoryCreateService } from "../../game/game-repository/game-repository-create.service";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { IgdbSyncService } from "./igdb-sync.service";
import { days, minutes } from "@nestjs/throttler";

/**
 * Recursively converts types of a game object.
 * @param game
 */
const convertIgdbResultTypes = (game: PartialGame) => {
    const gameWithParsedDates = parseGameDates(game);

    for (const [key, value] of Object.entries(gameWithParsedDates)) {
        if (value == undefined) {
        } else if (isEmptyObject(value)) {
            gameWithParsedDates[key] = undefined;
            // A lot of things are of type object, including dates and arrays, so we need to check for those first
        } else if (typeof value === "object" && value.constructor === Object) {
            gameWithParsedDates[key] = convertIgdbResultTypes(value);
        } else if (Array.isArray(value) && value.length > 0) {
            gameWithParsedDates[key] = value.map((item) =>
                convertIgdbResultTypes(item),
            );
        }
    }

    return gameWithParsedDates;
};

function normalizeIgdbResults(results: any[]) {
    const normalizedResults: PartialGame[] = [];
    for (const result of results) {
        // Do basic parsing (converts fields to camelCase)
        const normalizedResult: PartialGame = objectKeysToCamelCase(result);

        if (normalizedResult.gameLocalizations) {
            normalizedResult.localizations = normalizedResult.gameLocalizations;
        }

        const convertedResult = convertIgdbResultTypes(normalizedResult);

        normalizedResults.push(convertedResult);
    }

    return normalizedResults;
}

@Processor(IGDB_SYNC_QUEUE_NAME)
export class IgdbSyncProcessor extends WorkerHostProcessor {
    logger = new Logger(IgdbSyncProcessor.name);

    constructor(
        @InjectQueue(IGDB_SYNC_QUEUE_NAME)
        private readonly igdbSyncQueue: Queue,
        private readonly igdbSyncService: IgdbSyncService,
        private readonly gameRepositoryCreateService: GameRepositoryCreateService,
    ) {
        super();
        this.registerSyncJob();
    }

    /**
     * Registers a BullMQ Repeatable Job responsible for starting the actual
     * sync process on an interval.
     * BullMQ only stores a single job for the same 'repeat' options.
     * @private
     */
    private registerSyncJob() {
        // if (process.env.NODE_ENV !== "production") {
        //     this.logger.warn(
        //         "Aborted IGDB Sync job registering for non-production environments. To re-enable, comment this code in IgdbSyncProcessor#registerSyncJob",
        //     );
        //     return;
        // }
        this.igdbSyncQueue
            .add(IGDB_SYNC_FETCH_JOB_NAME, undefined, {
                repeat: {
                    // “At 00:00 on Monday and Thursday.”
                    pattern: "0 0 * * 1,4",
                },
                attempts: 3,
            })
            .then((job) => {
                this.logger.log("Registered IGDB sync fetch job");
                this.logger.log(JSON.stringify(job));
            })
            .catch((err) => {
                this.logger.error("Failed to register IGDB sync fetch job!");
                this.logger.error(err);
            });
    }

    async process(job: Job<any[]>) {
        if (job.name === IGDB_SYNC_JOB_NAME) {
            const results = job.data;

            const normalizedResults = normalizeIgdbResults(results);

            for (const result of normalizedResults) {
                await this.gameRepositoryCreateService.createOrUpdate(result);
            }

            return;
        } else if (job.name === IGDB_SYNC_FETCH_JOB_NAME) {
            await this.igdbSyncService.sync();
            return;
        }
    }
}
