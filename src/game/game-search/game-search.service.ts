import { HttpException, Injectable } from "@nestjs/common";
import {
    Configuration,
    IndexApi,
    SearchApi,
    ResponseError,
} from "manticoresearch-ts/dist/src";

import { GameSearchRequestDto } from "./dto/game-search-request.dto";
import {
    objectKeysToCamelCase,
    parseGameDates,
} from "../utils/game-conversor-utils";
import {
    GameSearchResponseDto,
    GameSearchResponseHit,
} from "./dto/game-search-response.dto";

@Injectable()
export class GameSearchService {
    private readonly config: Configuration;
    private readonly searchClient: SearchApi;
    constructor() {
        const basePath = process.env.MANTICORESEARCH_URL!;
        if (!basePath) {
            throw new Error("MANTICORESEARCH_URL is not set");
        }
        this.config = new Configuration({
            basePath,
        });
        this.searchClient = new SearchApi(this.config);
    }

    async search(
        request: GameSearchRequestDto,
    ): Promise<GameSearchResponseDto> {
        const search = await this.searchClient.search(request);
        if (search == undefined) {
            throw new HttpException("No results found", 404);
        }
        const normalizedSearch = objectKeysToCamelCase(
            search,
        ) as GameSearchResponseDto;

        if (normalizedSearch.hits && normalizedSearch.hits.hits) {
            normalizedSearch.hits.hits = normalizedSearch.hits.hits.map(
                (game) => parseGameDates(game) as GameSearchResponseHit,
            );
        } else {
            throw new HttpException(
                "No results found for the provided query.",
                404,
            );
        }

        return normalizedSearch;
    }
}
