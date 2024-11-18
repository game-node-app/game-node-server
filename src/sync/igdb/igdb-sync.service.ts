import { Injectable, Logger } from "@nestjs/common";
import { RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import { GameRepositoryCreateService } from "../../game/game-repository/game-repository-create.service";
import { PartialGame } from "../../game/game-repository/game-repository.types";
import {
    objectKeysToCamelCase,
    parseGameDates,
} from "./utils/game-conversor-utils";
import isEmptyObject from "../../utils/isEmptyObject";

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

/**
 * Queue responsible for syncing games from IGDB (results already fetched) to our database.
 * This queue is used by the IGDB Sync service. It doesn't process the results on its own. <br><br>
 * See game-queue.processor.ts for processing logic.
 */
@Injectable()
export class IgdbSyncService {
    private logger = new Logger(IgdbSyncService.name);

    constructor(
        private readonly gameRepositoryCreateService: GameRepositoryCreateService,
    ) {}

    /**
     * Subscription to events sent by game-node-sync-igdb trough RabbitMQ.
     * @param msg - array of 'Game' objects, following IGDB API specification.
     */
    @RabbitSubscribe({
        exchange: "sync",
        routingKey: "sync-igdb",
        queue: "sync",
        name: "sync",
    })
    async subscribe(msg: NonNullable<PartialGame[]>) {
        if (msg == undefined || !Array.isArray(msg)) {
            this.logger.error(
                `Ignoring malformed message on subscribe: ${msg}`,
            );
            return;
        }

        const normalizedResults = normalizeIgdbResults(msg);

        for (const result of normalizedResults) {
            this.gameRepositoryCreateService
                .createOrUpdate(result)
                .then()
                .catch((err) => {
                    this.logger.error(err);
                });
        }
    }
}
