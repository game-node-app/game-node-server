import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
import igdb from "igdb-api-node";
import { FindIgdbDto } from "./dto/find-igdb.dto";
import { ImageSize } from "./igdb.constants";
import { getSizedImageUrl } from "./igdb.utils";
import {
    IgdbAuthService,
    TOKEN_REFRESH_INTERVAL_SECONDS,
} from "./igdb.auth.service";
import * as process from "process";
import { Interval } from "@nestjs/schedule";
import { GameMetadata } from "../utils/game-metadata.dto";
import { FindIgdbIdDto } from "./dto/find-igdb-id.dto";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { AxiosResponse } from "axios";
import {
    TPaginationData,
    TPaginationInfo,
    TPaginationResponse,
} from "../utils/buildPaginationResponse";

function normalizeResults(
    results: any[],
    coverSize?: ImageSize,
    imageSize?: ImageSize,
): GameMetadata[] {
    /**
     * Predefined descriptions of some of the images that IGDB returns.
     * Cover: The cover image of the game.
     * Screenshots: The screenshots of the game. Generally these should be bigger than a cover's.
     * Artworks: The artworks of the game. Generally these should be bigger than a cover's.
     */
    const images = [
        { name: "cover", size: coverSize, fallback: "cover_big" },
        {
            name: "screenshots",
            size: imageSize,
            fallback: "screenshot_big",
        },
        { name: "artworks", size: imageSize, fallback: "screenshot_big" },
    ];

    const normalizedResults: GameMetadata[] = [];
    for (const result of results) {
        let normalizedResult: GameMetadata = {
            igdbId: result.id,
            name: result.name,
            category: result.category,
        };
        for (const image of images) {
            if (result[image.name]) {
                if (Array.isArray(image)) {
                    normalizedResult[image.name] = result[image.name].map(
                        (imageProperties: any) => {
                            return getSizedImageUrl(
                                imageProperties.url,
                                image.size || (image.fallback as ImageSize),
                            );
                        },
                    );
                } else {
                    normalizedResult[image.name] = getSizedImageUrl(
                        result[image.name].url,
                        image.size || (image.fallback as ImageSize),
                    );
                }
            }
        }

        normalizedResult = {
            ...normalizedResult,
            dlcs: result.dlcs,
            expansions: result.expansions,
            firstReleaseDate: result.first_release_date,
            genres: result.genres,
            similarGames: result.similar_games,
            storyline: result.storyline,
            totalRating: result.total_rating,
            igdbUrl: result.url,
            collection: result.collection,
        };
        normalizedResults.push(normalizedResult);
    }
    return normalizedResults;
}

@Injectable()
export class IgdbService {
    private CACHE_TIME_SECONDS = 1800;
    private igdbClient: ReturnType<typeof igdb>;
    private readonly igdbFields = [
        "id",
        "name",
        "screenshots.*",
        "game_modes.*",
        "genres.*",
        "platforms.*",
        "dlcs.*",
        "rating",
        "expansions.*",
        "similar_games",
        "cover.*",
        "artworks.*",
        "collection",
        "category",
        "language_supports.*",
        "first_release_date",
    ];
    private logger: Logger;
    constructor(
        private igdbAuthService: IgdbAuthService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {
        this.logger = new Logger(IgdbService.name);
        this.buildIgdbClient().then();
    }

    @Interval(TOKEN_REFRESH_INTERVAL_SECONDS * 1000)
    async buildIgdbClient(): Promise<void> {
        const token = await this.igdbAuthService.refreshToken();
        this.igdbClient = igdb(process.env.IGDB_CLIENT_ID, token);
        this.logger.log(
            "Built a fresh IGDB client at " + new Date().toISOString(),
        );
    }

    async getFromStore(key: string) {
        try {
            return await this.cacheManager.get<GameMetadata[]>(key);
        } catch (e) {
            this.logger.error(e.message, e.stack);
            return undefined;
        }
    }

    async setToStore(key: string, results: GameMetadata[]) {
        try {
            await this.cacheManager.set(
                key,
                results,
                this.CACHE_TIME_SECONDS * 1000,
            );
        } catch (e) {
            this.logger.error(e.message, e.stack);
        }
    }

    buildStoreKey(dto: object) {
        return JSON.stringify(dto);
    }

    /**
     * A shorthand that builds a where clause based on the provided ids.
     * @param queryIdDto
     */
    async findByIds(
        queryIdDto: FindIgdbIdDto,
    ): Promise<TPaginationData<GameMetadata>> {
        if (!queryIdDto || !queryIdDto.igdbIds) {
            throw new HttpException("No ids provided", HttpStatus.BAD_REQUEST);
        }
        const idsStringArray = queryIdDto.igdbIds.map((v) => `${v}`);
        if (idsStringArray.length === 0) {
            throw new HttpException("No ids provided", HttpStatus.BAD_REQUEST);
        }
        const idsString = idsStringArray.join(",");

        const where = `id = (${idsString})`;
        const queryDto: FindIgdbDto = {
            ...queryIdDto,
            where,
        };
        return await this.find(queryDto);
    }

    async findByIdsOrFail(queryIdDto: FindIgdbIdDto) {
        const result = await this.findByIds(queryIdDto);
        if (result === undefined || result[0].length === 0) {
            throw new HttpException("No games found", HttpStatus.NOT_FOUND);
        }
        return result;
    }

    async find(queryDto: FindIgdbDto): Promise<TPaginationData<GameMetadata>> {
        const limit = queryDto.limit || 20;
        const offset = queryDto.offset || 0;
        const search = this.igdbClient
            .fields(this.igdbFields)
            .limit(limit)
            .offset(offset);

        if (queryDto.search) {
            search.search(queryDto.search);
        }
        if (queryDto.sort) {
            search.sort(queryDto.sort);
        }
        if (queryDto.where) {
            search.where(queryDto.where);
        }

        let results: AxiosResponse;
        try {
            results = (await search.request("/games")) as AxiosResponse<any>;
        } catch (e: any) {
            this.logger.error(e.message, e.stack);
            if (e.status) {
                throw new HttpException(e.message, e.status);
            } else {
                throw new HttpException(
                    e.message,
                    HttpStatus.INTERNAL_SERVER_ERROR,
                );
            }
        }
        let normalizedResults: GameMetadata[] = [];
        try {
            normalizedResults = normalizeResults(
                results.data,
                queryDto.coverSize,
                queryDto.imageSize,
            );
        } catch (e) {
            this.logger.error(e.message, e.stack);
            throw new HttpException(
                e.message,
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }

        if (normalizedResults == null || normalizedResults.length === 0) {
            throw new HttpException(
                "No games found for the given query parameters.",
                HttpStatus.NOT_FOUND,
            );
        }

        // Fallback to the total count of the first result if the total count is not available
        // If this is used, hasNextPage will always be false.
        let totalItems = normalizedResults.length;
        const countHeader = results.headers["x-count"];
        if (countHeader && countHeader !== "") {
            totalItems = parseInt(countHeader, 10);
        }

        return [normalizedResults, totalItems];
    }

    async findOrFail(queryDto: FindIgdbDto) {
        const result = await this.find(queryDto);
        const [games, _] = result;
        if (games === undefined || games.length === 0) {
            throw new HttpException("No games found", HttpStatus.NOT_FOUND);
        }

        return result;
    }
}
