import { Injectable, Logger } from "@nestjs/common";
import igdb from "igdb-api-node";
import * as process from "process";
import { IgdbSyncAuthService } from "./igdb-sync-auth.service";
import * as retry from "async-retry";
import { IgdbSyncQueueService } from "./igdb-sync-queue/igdb-sync-queue.service";
import sleep from "../utils/sleep";

@Injectable()
/**
 * Sync service responsible for fetching and updating entries to GameNode's database.
 * Creates and updates "Game" entities.
 */
export class IgdbSyncService {
    private logger = new Logger(IgdbSyncService.name);
    // IGDB API's limit
    private readonly itemsPerPage = 500;
    // IGDB API's fields
    private readonly igdbSearchFields = [
        "id",
        "name",
        "slug",
        "checksum",
        "aggregated_rating",
        "aggregated_rating_count",
        "status",
        "summary",
        "url",
        "screenshots.*",
        "game_modes.*",
        "expanded_games.id",
        "expanded_games.name",
        "expanded_games.slug",
        "category",
        "genres.*",
        "platforms.*",
        "dlcs.id",
        "dlcs.name",
        "dlcs.slug",
        "expansions.id",
        "expansions.name",
        "expansions.slug",
        "similar_games.id",
        "similar_games.name",
        "similar_games.slug",
        "cover.*",
        "artworks.*",
        "collection.*",
        "alternative_names.*",
        "external_games.*",
        "franchises.*",
        "keywords.*",
        "game_localizations.*",
        "language_supports.*",
        "first_release_date",
    ];

    constructor(
        private igdbAuthService: IgdbSyncAuthService,
        private igdbSyncQueueService: IgdbSyncQueueService,
    ) {
        this.logger.log("Created IGDB sync service instance");
        this.start();
    }

    /**
     * Builds a IGDB client (trying to refresh the IGDB token if necessary).
     */
    async buildIgdbClient(): Promise<ReturnType<typeof igdb>> {
        const token = await this.igdbAuthService.refreshToken();
        const igdbClient = igdb(process.env.TWITCH_CLIENT_ID, token);
        this.logger.log(
            "Built a fresh IGDB client at " + new Date().toISOString(),
        );

        return igdbClient;
    }

    /**
     * Fetches entries from IGDB.
     * Do not handle errors here, as this is called by start() which already handles errors.
     * @param offset
     */
    private async fetch(offset: number) {
        const igdbClient = await this.buildIgdbClient();
        // Basic search parameters
        const search = igdbClient
            .fields(this.igdbSearchFields)
            .limit(500)
            .offset(offset);

        const results = await search.request("/games");
        return results;
    }

    /**
     * Starts the IGDB sync process.
     * Fetches entries (with fetch()), handles errors with async-retry and sends results with to queue.
     */
    async start(): Promise<void> {
        this.logger.log("Starting IGDB sync at ", new Date().toISOString());

        let hasNextPage = true;
        let currentOffset = 0;
        while (hasNextPage) {
            this.logger.log(`Fetching results from offset ${currentOffset}`);
            await retry(
                async () => {
                    const results = await this.fetch(currentOffset);
                    if (results.data.length === 0) {
                        hasNextPage = false;
                        return;
                    }
                    // Sends results to queue.
                    await this.igdbSyncQueueService.handle(results.data);
                    currentOffset += this.itemsPerPage;
                    hasNextPage = results.data.length >= this.itemsPerPage;

                    // Wait 2 seconds before fetching again.
                    // We are fetching a lot of data, after all.
                    await sleep(2000);
                },
                {
                    retries: 3,
                    onRetry: (err, attempt) => {
                        this.logger.error(`Error while fetching IGDB results:`);
                        this.logger.error(err);
                        this.logger.error(`Retry attempts: ${attempt} of 3`);
                    },
                    minTimeout: 10000,
                },
            );
        }
    }
}
