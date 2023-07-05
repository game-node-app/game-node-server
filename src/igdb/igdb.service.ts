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
    tokenRefreshIntervalSeconds,
} from "./igdb.auth.service";
import * as process from "process";
import { Interval } from "@nestjs/schedule";
import { GameMetadata } from "../utils/game-metadata.dto";
import { FindIgdbIdDto } from "./dto/find-igdb-id.dto";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";

function normalizeResults(
    results: any[],
    coverSize?: ImageSize,
    imageSize?: ImageSize,
): GameMetadata[] {
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
        "expansions.*",
        "similar_games",
        "cover.*",
        "artworks.*",
        "collection",
        "category",
    ];
    private logger: Logger;
    constructor(
        private igdbAuthService: IgdbAuthService,
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
    ) {
        this.logger = new Logger(IgdbService.name);
        this.buildIgdbClient().then();
    }

    @Interval(tokenRefreshIntervalSeconds * 1000)
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

    async findByIds(queryIdDto: FindIgdbIdDto) {
        try {
            const storeKey = this.buildStoreKey(queryIdDto);
            const cached = await this.getFromStore(storeKey);
            if (cached) {
                return cached;
            }
        } catch (e) {
            this.logger.error("Error while loading cached entries");
            this.logger.error(e.message, e.stack);
        }

        const search = this.igdbClient
            .fields(this.igdbFields)
            .limit(queryIdDto.limit || 20)
            .offset(queryIdDto.offset || 0);

        if (queryIdDto.sort) {
            search.sort(queryIdDto.sort);
        }
        const idsStringArray = queryIdDto.igdbIds.map((v) => `${v}`);
        search.where(`id = (${idsStringArray})`);
        const request = await search.request("/games");

        const results = normalizeResults(
            request.data,
            queryIdDto.coverSize,
            queryIdDto.imageSize,
        );

        try {
            const storeKey = this.buildStoreKey(queryIdDto);
            await this.setToStore(storeKey, results);
        } catch (e) {
            this.logger.error("Error while saving cached entries");
            this.logger.error(e.message, e.stack);
        }

        return results;
    }

    async findByIdsOrFail(queryIdDto: FindIgdbIdDto) {
        const games = await this.findByIds(queryIdDto);
        if (games === undefined || games.length === 0) {
            throw new HttpException("No games found", HttpStatus.NOT_FOUND);
        }
        return games;
    }

    async find(queryDto: FindIgdbDto): Promise<GameMetadata[]> {
        const search = this.igdbClient
            .fields(this.igdbFields)
            .limit(queryDto.limit || 20)
            .offset(queryDto.offset || 0);

        if (queryDto.search) {
            search.search(queryDto.search);
        }
        if (queryDto.sort) {
            search.sort(queryDto.sort);
        }
        if (queryDto.where) {
            search.where(queryDto.where);
        }
        try {
            const results = await search.request("/games");
            return normalizeResults(
                results.data,
                queryDto.coverSize,
                queryDto.imageSize,
            );
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
    }
}
