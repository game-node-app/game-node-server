import { Injectable } from "@nestjs/common";
import * as Manticoresearch from "manticoresearch";
import { ApiClient, SearchApi } from "manticoresearch";
import { GameSearchRequestDto } from "./dto/game-search-request.dto";

@Injectable()
export class GameSearchService {
    private readonly client: ApiClient;
    private readonly searchClient: SearchApi;

    constructor() {
        this.client = new Manticoresearch.ApiClient();
        const basePath = process.env.MANTICORESEARCH_URL!;
        if (!basePath) {
            throw new Error("MANTICORESEARCH_URL is not set");
        }
        this.searchClient = new Manticoresearch.SearchApi(this.client);
    }

    async search(query: GameSearchRequestDto) {
        return await this.searchClient.search(query);
    }
}
