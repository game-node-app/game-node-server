import { Process, Processor } from "@nestjs/bull";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GameService } from "../../game/game.service";
import { Logger } from "@nestjs/common";
import { PartialGame } from "../../game/game.types";
import isEmptyObject from "../../utils/isEmptyObject";
import { Job } from "bull";
import { IGDB_SYNC_QUEUE_NAME } from "./igdb-sync-queue.constants";

const snakeCaseToCamelCase = (str: string) => {
    return str.replace(/([-_][a-z])/g, (group) =>
        group.toUpperCase().replace("-", "").replace("_", ""),
    );
};

const objectKeysToCamelCase = (obj: any): any => {
    // Only converts objects which are actual objects (not arrays, not null, not undefined, not numbers, etc)
    if (obj == null || typeof obj !== "object") {
        return obj;
    } else if (Array.isArray(obj)) {
        return obj.map((item) => objectKeysToCamelCase(item));
    }

    const camelCaseObj: any = {};
    // eslint-disable-next-line prefer-const
    for (let [key, value] of Object.entries(obj)) {
        if (typeof value === "object" && value != null) {
            camelCaseObj[snakeCaseToCamelCase(key)] =
                objectKeysToCamelCase(value);
            continue;
        }

        camelCaseObj[snakeCaseToCamelCase(key)] = value;
    }

    return camelCaseObj;
};

/**
 * TODO: find a better name for this
 * Recursively validates a game object.
 * @param game
 */
const validateResult = (game: PartialGame) => {
    const validatedGame = game;
    const dateFields = ["createdAt", "updatedAt", "firstReleaseDate"];

    for (const [key, value] of Object.entries(validatedGame)) {
        if (value == undefined) {
        } else if (isEmptyObject(value)) {
            validatedGame[key] = undefined;

            // A lot of things are of type object, including dates and arrays, so we need to check for those first
        } else if (typeof value === "object" && value.constructor === Object) {
            validatedGame[key] = validateResult(value);
        } else if (Array.isArray(value) && value.length > 0) {
            validatedGame[key] = value.map((item) => validateResult(item));
        } else if (dateFields.includes(key)) {
            if (typeof value === "number") {
                validatedGame[key] = new Date(value);
            }
        }
    }

    return validatedGame;
};

function normalizeResults(results: any[]) {
    const normalizedResults: PartialGame[] = [];
    for (const result of results) {
        // Do basic parsing (converts fields to camelCase)
        const normalizedResult: PartialGame = objectKeysToCamelCase(result);

        // Do more advanced parsing (converts fields to their respective types)
        if (
            normalizedResult.firstReleaseDate &&
            typeof normalizedResult.firstReleaseDate === "number"
        ) {
            normalizedResult.firstReleaseDate = new Date(
                normalizedResult.firstReleaseDate,
            );
        }

        if (normalizedResult.gameLocalizations) {
            normalizedResult.localizations = normalizedResult.gameLocalizations;
        }

        const validatedResult = validateResult(normalizedResult);

        normalizedResults.push(validatedResult);
    }

    return normalizedResults;
}

@Processor(IGDB_SYNC_QUEUE_NAME)
export class IgdbSyncQueueProcessor {
    private logger = new Logger(IgdbSyncQueueProcessor.name);

    constructor(private readonly gameService: GameService) {}

    @Process()
    async process(job: Job<any[]>) {
        const results = job.data;
        this.logger.log(`Processing ${results.length} results`);

        const normalizedResults = normalizeResults(results);

        for (const result of normalizedResults) {
            this.logger.log(`Processing result ${result.id}`);
            await this.gameService.createOrUpdate(result);
        }
        this.logger.log(`SUCCESS: Processed ${results.length} results`);
    }
}
