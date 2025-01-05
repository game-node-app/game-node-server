import { PaginationInfo } from "../utils/pagination/pagination-response.dto";

export type GameSearchRequestDto = {
    category?: Array<number>;
    genres?: Array<string>;
    limit?: number;
    page?: number;
    platforms?: Array<string>;
    profile?: boolean;
    query?: string;
    status?: Array<number>;
    themes?: Array<string>;
};

export type SearchGame = {
    aggregatedRating?: number;
    aggregatedRatingCount?: number;
    category?: number;
    checksum?: string;
    coverUrl?: string;
    createdAt?: string;
    firstReleaseDate?: string;
    genresNames?: string;
    id?: number;
    keywordsNames?: string;
    name?: string;
    numLikes?: number;
    numViews?: number;
    platformsAbbreviations?: string;
    platformsNames?: string;
    slug?: string;
    source?: string;
    status?: number;
    storyline?: string;
    summary?: string;
    themesNames?: string;
    updatedAt?: string;
};

export type GameSearchResponseData = {
    items?: Array<SearchGame>;
    profile?: any;
    took?: number;
};

export type GameSearchResponseDto = {
    data?: GameSearchResponseData;
    pagination?: PaginationInfo;
};
