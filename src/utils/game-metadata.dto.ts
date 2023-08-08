/**
 * The base metadata for all IGDB games.
 */
export class GameMetadata {
    [key: string]: any;

    igdbId: number;
    name: string;
    storyline?: string;
    totalRating?: number;
    igdbUrl?: string;
    /**
     * Cover image URL (if available)
     */
    cover?: string;
    screenshots?: string[];
    artworks?: string[];
    category: number;
    collection?: number;
    dlcs?: number[];
    expansions?: number[];
    firstReleaseDate?: number;
    genres?: string[];
    similarGames?: number[];
}
