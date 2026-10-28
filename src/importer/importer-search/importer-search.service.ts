import { Injectable } from "@nestjs/common";
import Fuse from "fuse.js";
import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
import { EImporterSource } from "../importer.constants";

@Injectable()
export class ImporterSearchService {
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
        return new Fuse<T>(items, {
            keys: ["name"],
        });
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
