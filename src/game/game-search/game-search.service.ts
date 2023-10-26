import { HttpException, Injectable } from "@nestjs/common";
import { Configuration, SearchApi } from "manticoresearch-ts/dist/src";

import { GameSearchRequestDto } from "./dto/game-search-request.dto";
import {
    objectKeysToCamelCase,
    parseGameDates,
} from "../utils/game-conversor-utils";
import {
    GameSearchResponseDto,
    SearchGame,
} from "./dto/game-search-response.dto";
import { EGameStorageSource } from "../utils/game-stored-source";

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
                (hit) => ({
                    ...hit,
                    _id: parseInt(hit._id as unknown as string),
                    _source: {
                        ...(parseGameDates(hit._source) as SearchGame),
                        id: parseInt(hit._id as unknown as string),
                        source: EGameStorageSource.MANTICORE,
                    },
                }),
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
