import { Injectable } from "@nestjs/common";
import { Cache } from "@nestjs/cache-manager";
import Fuse from "fuse.js";
import { ImporterResponseItemDto } from "../dto/importer-response-item.dto";

@Injectable()
export class ImporterSearchService {
    constructor(private readonly cacheManager: Cache) {}

    /**
     * Builds a list-specific Fuse client to perform search operations
     * @param items
     * @private
     */
    private buildFuseClient(items: ImporterResponseItemDto[]) {
        return new Fuse(items, {
            keys: ["name"],
        });
    }

    public async search(items: ImporterResponseItemDto[], query: string) {
        const client = this.buildFuseClient(items);

        return client.search(query).map((r) => r.item);
    }
}
