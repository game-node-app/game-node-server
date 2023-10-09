import { Injectable, Logger } from "@nestjs/common";
import igdb from "igdb-api-node";
import { Interval } from "@nestjs/schedule";
import * as process from "process";
import {
    IgdbSyncAuthService,
    TOKEN_REFRESH_INTERVAL_SECONDS,
} from "./igdb-sync-auth.service";
import { DeepPartial } from "typeorm";
import { Game } from "../game/entities/game.entity";
import { PartialGame } from "../game/game.types";
import { EGameCategory } from "../game/game.constants";
import { GameService } from "../game/game.service";
import isEmptyObject from "../utils/isEmptyObject";

const snakeCaseToCamelCase = (str: string) => {
    return str.replace(/([-_][a-z])/g, (group) =>
        group.toUpperCase().replace("-", "").replace("_", ""),
    );
};

const objectKeysToCamelCase = (obj: any) => {
    // Only converts objects which are actual objects (not arrays, not null, not undefined, not numbers, etc)
    if (obj == null || typeof obj !== "object") {
        return obj;
    } else if (Array.isArray(obj)) {
        return obj;
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

    for (const [key, value] of Object.entries(validatedGame)) {
        if (value == undefined) {
            continue;
        } else if (isEmptyObject(value)) {
            validatedGame[key] = undefined;
        } else if (typeof value === "object" && value.constructor === Object) {
            validatedGame[key] = validateResult(value);
        } else if (key === "createdAt" || key === "updatedAt") {
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
        if (normalizedResult.collection) {
            normalizedResult.collection = {
                ...normalizedResult.collection,
                games: undefined,
            };
        }

        const validatedResult = validateResult(normalizedResult);

        normalizedResults.push(validatedResult);
    }

    return normalizedResults;
}

@Injectable()
/**
 * Sync service responsible for fetching and updating entries to GameNode's database.
 * Creates and updates "Game" entities.
 */
export class IgdbSyncService {
    private logger = new Logger(IgdbSyncService.name);
    private igdbClient: ReturnType<typeof igdb>;
    // IGDB API's limit
    private readonly itemsPerPage = 500;
    private readonly igdbSearchFields = [
        "id",
        "name",
        "screenshots.*",
        "game_modes.*",
        "category",
        "genres.*",
        "platforms.*",
        "dlcs.*",
        "rating",
        "expansions.*",
        "similar_games.id",
        "cover.*",
        "artworks.*",
        "collection.*",
        "language_supports.*",
        "first_release_date",
    ];

    constructor(
        private igdbAuthService: IgdbSyncAuthService,
        private gameService: GameService,
    ) {
        this.logger.log("Created IGDB sync service instance");
        this.start();
    }

    // This basically calls setInterval on this function. Expect similar behaviour.
    @Interval(TOKEN_REFRESH_INTERVAL_SECONDS * 1000)
    /**
     * Builds a IGDB client (basically trying to refresh the IGDB token) every once in a while.
     * This is possible because NestJS Injectables are singletons.
     */
    async buildIgdbClient(): Promise<void> {
        const token = await this.igdbAuthService.refreshToken();
        this.igdbClient = igdb(process.env.TWITCH_CLIENT_ID, token);
        this.logger.log(
            "Built a fresh IGDB client at " + new Date().toISOString(),
        );
    }

    async start(): Promise<void> {
        this.logger.log("Starting IGDB sync");
        if (this.igdbClient == undefined) {
            await this.buildIgdbClient();
        }

        let hasNextPage = true;
        let currentOffset = 0;

        while (hasNextPage) {
            const search = this.igdbClient
                .fields(this.igdbSearchFields)
                .limit(500)
                .offset(currentOffset);
            try {
                this.logger.log(
                    "Fetching IGDB data with offset " + currentOffset,
                );
                const results = await search.request("/games");
                this.logger.log(
                    "Finished fetching IGDB results at " +
                        new Date().toISOString(),
                );
                const normalizedResults = normalizeResults(results.data);
                this.logger.log("Normalized IGDB results");
                this.logger.log("Attempting to save normalized results");
                for (const game of normalizedResults) {
                    this.logger.log(
                        "Attempting to save game with id: " + game.id,
                    );
                    this.logger.log(game);
                    await this.gameService.createOrUpdate(game);
                }
            } catch (e: any) {
                console.error(e);
                break;
            }

            this.logger.warn("IGDB sync is not implemented yet! Forcing break");
            break;
        }
    }
}
