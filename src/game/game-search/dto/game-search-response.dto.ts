import {
    SearchResponse,
    SearchResponseHits,
} from "manticoresearch-ts/dist/src";
import { Game } from "../../game-repository/entities/game.entity";
import { PickType } from "@nestjs/swagger";
import { EGameStorageSource } from "../../utils/game-stored-source";

/**
 * This reflects the slightly changed response from ManticoreSearch
 * Basically, a Game Entity with some shorthand fields to avoid querying for extra relationships.
 */
export class SearchGame extends PickType(Game, [
    "id",
    "name",
    "slug",
    "summary",
    "storyline",
    "checksum",
    "aggregatedRating",
    "aggregatedRatingCount",
    "category",
    "status",
    "firstReleaseDate",
    "createdAt",
    "updatedAt",
]) {
    coverUrl?: string;
    numViews?: number;
    numLikes?: number;
    genresNames?: string;
    platformsNames?: string;
    platformsAbbreviations?: string;
    keywordsNames?: string;
    source: EGameStorageSource = EGameStorageSource.MANTICORE;
}

export class GameSearchResponseHit {
    /**
     * This is returned as a string from Manticore, but is converted before return to the client.
     */
    _id: number;
    _score: number;
    _source: SearchGame;
}

export class GameSearchResponseHits implements SearchResponseHits {
    /**
     *
     * @type {number}
     * @memberof SearchResponseHits
     */
    max_score?: number;
    /**
     *
     * @type {number}
     * @memberof SearchResponseHits
     */
    total?: number;
    /**
     *
     * @type {string}
     * @memberof SearchResponseHits
     */
    total_relation?: string;
    /**
     *
     * @type {Array<object>}
     * @memberof SearchResponseHits
     */
    hits?: GameSearchResponseHit[];
}

export class GameSearchResponseDto implements SearchResponse {
    /**
     *
     * @type {number}
     * @memberof SearchResponse
     */
    took?: number;
    /**
     *
     * @type {boolean}
     * @memberof SearchResponse
     */
    timed_out?: boolean;
    /**
     *
     * @type {{ [key: string]: any; }}
     * @memberof SearchResponse
     */
    aggregations?: {
        [key: string]: any;
    };

    hits?: GameSearchResponseHits;
    /**
     *
     * @type {object}
     * @memberof SearchResponse
     */
    profile?: object;
    /**
     *
     * @type {{ [key: string]: any; }}
     * @memberof SearchResponse
     */
    warning?: {
        [key: string]: any;
    };
}
