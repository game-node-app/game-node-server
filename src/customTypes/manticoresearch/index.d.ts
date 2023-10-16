/**
 * Custom-typings for ManticoreSearch
 * They don't provide any typings yet, so we have to do it ourselves.
 * Reference: https://github.com/manticoresoftware/manticoresearch-javascript/tree/master/docs
 */

declare class Manticoresearch {
    static ApiClient: ApiClient;
    static SearchApi: SearchApi;
}

declare module "manticoresearch" {
    export interface Aggregation {
        name: string;
        field: string;
        /**
         * Defaults to 20.
         */
        size?: number;
    }

    export interface Highlight {
        [key: string]: any;
    }

    /**
     * https://manual.manticoresearch.com/Searching/Options#Search-options
     */
    export interface SearchRequest {
        index: string;
        query: object;
        fulltext_filter?: object;
        attr_filter?: object;
        limit?: number;
        offset?: number;
        max_matches?: number;
        sort?: object[];
        aggs?: Aggregation[];
        expressions?: object;
        highlight?: Highlight;
        source?: {
            [key: string]: object;
        };
        profile?: boolean;
        track_scores?: boolean;
    }

    export interface SearchResponseHits {
        /**
         * ID of the matched document.
         */
        _id: any;
        _score: number;
        _source: object;
        max_score?: number;
        total?: number;
        total_relation?: string;
        hits: object;
    }

    export interface SearchResponse {
        took: number;
        timed_out: boolean;
        aggregations: {
            [key: string]: object;
        };
        hits: SearchResponseHits[];
        profile: object;
        warning: {
            [key: string]: object;
        };
    }

    declare class ApiClient {
        public basePath: string;

        constructor();
    }

    declare class SearchApi {
        constructor(apiClient: ApiClient);

        /**
         * Performs a search request on an index.
         * POST /search
         */
        async search(request: SearchRequest): Promise<SearchResponse>;
    }

    export type { SearchApi, ApiClient };

    export default Manticoresearch;

    export = Manticoresearch;
}
