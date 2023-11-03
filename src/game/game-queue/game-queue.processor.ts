import { Process, Processor } from "@nestjs/bull";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GameRepositoryService } from "../game-repository/game-repository.service";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { GAME_QUEUE_NAME } from "./game-queue.constants";
import { PartialGame } from "../game-repository/game-repository.types";
import isEmptyObject from "../../utils/isEmptyObject";
import {
    objectKeysToCamelCase,
    parseGameDates,
} from "../utils/game-conversor-utils";

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

@Processor(GAME_QUEUE_NAME)
export class GameQueueProcessor {
    private logger = new Logger(GameQueueProcessor.name);

    constructor(private readonly gameService: GameRepositoryService) {}

    @Process({
        concurrency: 1,
    })
    async process(job: Job<any[]>) {
        const results = job.data;

        const normalizedResults = normalizeIgdbResults(results);

        const tasks: Promise<any>[] = [];

        for (const result of normalizedResults) {
            tasks.push(this.gameService.createOrUpdate(result));
        }

        await Promise.all(tasks);
    }
}
