import {
    SearchResponse,
    SearchResponseHits,
} from "manticoresearch-ts/dist/src";
import { Game } from "../../game-repository/entities/game.entity";
import { PickType } from "@nestjs/swagger";

/**
 * This reflects the slightly changed response from ManticoreSearch
 * Basically, a Game Entity with some shorthand fields to avoid querying for extra relationships.
 */
export class GameSearchResponseHit extends PickType(Game, [
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
    numViews?: number;
    numLikes?: number;
    genresNames: string[];
    platformsNames: string[];
    platformsAbbreviations: string[];
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
    hits?: Array<GameSearchResponseHit>;
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
