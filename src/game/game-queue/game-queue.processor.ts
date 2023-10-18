import { Process, Processor } from "@nestjs/bull";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { GameRepositoryService } from "../game-repository/game-repository.service";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { GAME_QUEUE_NAME } from "./game-queue.constants";
import { PartialGame } from "../game-repository/game-repository.types";
import isEmptyObject from "../../utils/isEmptyObject";
import { objectKeysToCamelCase } from "../../utils/case-convert";

/**
 * Recursively converts types of a game object.
 * @param game
 */
const convertIgdbResultTypes = (game: PartialGame) => {
    const validatedGame = game;
    // Keep in mind that these are UNIX timestamps, in seconds.
    const dateFields = [
        "createdAt",
        "created_at",
        "updatedAt",
        "updated_at",
        "firstReleaseDate",
        "first_release_date",
    ];

    for (const [key, value] of Object.entries(validatedGame)) {
        if (value == undefined) {
        } else if (isEmptyObject(value)) {
            validatedGame[key] = undefined;
            // A lot of things are of type object, including dates and arrays, so we need to check for those first
        } else if (typeof value === "object" && value.constructor === Object) {
            validatedGame[key] = convertIgdbResultTypes(value);
        } else if (Array.isArray(value) && value.length > 0) {
            validatedGame[key] = value.map((item) =>
                convertIgdbResultTypes(item),
            );
        } else if (dateFields.includes(key) && typeof value === "number") {
            let asDate: Date | undefined = new Date(value * 1000);

            // Dates can't be invalid or in the future.
            if (
                asDate.toString() === "Invalid Date" ||
                asDate.getTime() > Date.now()
            ) {
                asDate = undefined;
            }
            validatedGame[key] = asDate;
        }
    }

    return validatedGame;
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

    @Process()
    async process(job: Job<any[]>) {
        const results = job.data;
        // this.logger.log(`Processing ${results.length} results`);

        const normalizedResults = normalizeIgdbResults(results);

        for (const result of normalizedResults) {
            // this.logger.log(`Processing result ${result.id}`);
            this.gameService
                .createOrUpdate(result)
                // .then(() => this.logger.log(`Processed result ${result.id}`))
                .catch((e) => {
                    this.logger.error(
                        `Error while processing result ${result.id}`,
                        e,
                    );
                });
        }
        // this.logger.log(`SUCCESS: Processed ${results.length} results`);
    }
}
