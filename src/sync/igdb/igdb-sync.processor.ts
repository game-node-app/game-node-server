import { Processor } from "@nestjs/bullmq";
import { Logger } from "@nestjs/common";
import { Job, WorkerOptions } from "bullmq";
import {
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

@Processor(IGDB_SYNC_QUEUE_NAME, {
    // Makes the process slower, but allows us to keep functioning while it's working.
    // Keep in mind that this involves processing operations in batches of 10 entities.
    limiter: {
        max: 1,
        duration: 500,
    },
})
export class IgdbSyncProcessor extends WorkerHostProcessor {
    logger = new Logger(IgdbSyncProcessor.name);

    constructor(
        private readonly gameRepositoryCreateService: GameRepositoryCreateService,
    ) {
        super();
    }

    async process(job: Job<any[]>) {
        if (job.name === IGDB_SYNC_JOB_NAME) {
            const results = job.data;

            const normalizedResults = normalizeIgdbResults(results);

            const tasks: Promise<void>[] = [];

            for (const result of normalizedResults) {
                tasks.push(
                    this.gameRepositoryCreateService.createOrUpdate(result),
                );
            }

            await Promise.all(tasks);
        }
    }
}
