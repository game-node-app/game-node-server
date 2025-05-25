import { Injectable, Logger } from "@nestjs/common";
import { Cache } from "@nestjs/cache-manager";
import Fuse, { FuseIndex } from "fuse.js";
import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
import { EImporterSource } from "../importer.constants";
import { minutes } from "@nestjs/throttler";

@Injectable()
export class ImporterSearchService {
    private readonly logger = new Logger(ImporterSearchService.name);

    constructor(private readonly cacheManager: Cache) {}

    private async buildFuseIndex<T extends GameExternalGame>(
        userId: string,
        source: EImporterSource,
        items: T[],
    ) {
        const cacheKey = `importer-search-${userId}-${source}`;

        const indexInCache =
            await this.cacheManager.get<
                ReturnType<FuseIndex<unknown>["toJSON"]>
            >(cacheKey);

        if (indexInCache) return indexInCache;

        const createdIndex = Fuse.createIndex(["name"], items).toJSON();

        this.cacheManager
            .set(cacheKey, createdIndex, minutes(15))
            .catch((err) => this.logger.error(err));

        return createdIndex;
    }

    /**
     * Builds a list-specific Fuse client to perform search operations
     * @param userId
     * @param source
     * @param items
     * @private
     */
    private async buildFuseClient<T extends GameExternalGame>(
        userId: string,
        source: EImporterSource,
        items: T[],
    ) {
        const index = await this.buildFuseIndex(userId, source, items);

        return new Fuse<T>(
            items,
            {
                keys: ["name"],
            },
            Fuse.parseIndex(index),
        );
    }

    public async search<T extends GameExternalGame>(
        userId: string,
        source: EImporterSource,
        items: T[],
        query: string,
    ) {
        const client = await this.buildFuseClient(userId, source, items);

        return client.search(query).map((r) => r.item);
    }
}
