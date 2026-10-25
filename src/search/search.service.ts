import {
    BadGatewayException,
    BadRequestException,
    GatewayTimeoutException,
    HttpException,
    Injectable,
    Logger,
    Optional,
    ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { AxiosError } from "axios";
import { firstValueFrom } from "rxjs";
import { ObjectLiteral, Repository } from "typeorm";
import { GameGenre } from "../game/game-repository/entities/game-genre.entity";
import { GamePlatform } from "../game/game-repository/entities/game-platform.entity";
import { GameTheme } from "../game/game-repository/entities/game-theme.entity";
import {
    GameAutocompleteRequestDto,
    GameSearchRequestDto,
} from "./dto/game-search-request.dto";
import {
    GameAutocompleteResponseDto,
    GameSearchResponseDataDto,
    GameSearchResponseDto,
    SearchGameDto,
} from "./dto/game-search-response.dto";
import { SearchPaginationInfoDto } from "./dto/search-pagination.dto";
import { resolveEffectivePagination } from "./dto/search-validation";
import { UserSearchRequestDto } from "./dto/user-search-request.dto";
import {
    SearchUserDto,
    UserSearchResponseDataDto,
    UserSearchResponseDto,
} from "./dto/user-search-response.dto";
import {
    SEARCH_AUTOCOMPLETE_LIMIT,
    SEARCH_AUTOCOMPLETE_PAGE,
    SEARCH_DEFAULT_MANTICORE_URL,
    SEARCH_ENGINE_TIMEOUT_MS,
    SEARCH_GAMES_TABLE,
    SEARCH_MAX_LIMIT,
    SEARCH_MAX_OFFSET,
    SEARCH_SOURCE_MANTICORE,
    SEARCH_USERS_TABLE,
} from "./search.constants";

export type SearchEngineTable =
    | typeof SEARCH_GAMES_TABLE
    | typeof SEARCH_USERS_TABLE;

export interface ResolvedGameRelationFilters {
    genreIds?: number[];
    themeIds?: number[];
    platformIds?: number[];
    shortCircuitEmpty: boolean;
}

export interface ManticoreQueryFilter {
    match_phrase?: {
        "name,alternative_names": string;
    };
    match?: {
        username: string;
    };
    in?: Record<
        "category" | "status" | "genre_ids" | "theme_ids" | "platform_ids",
        number[]
    >;
}

export interface ManticoreSearchRequest {
    table: SearchEngineTable;
    query: {
        bool?: {
            must: ManticoreQueryFilter[];
        };
        match?: {
            username: string;
        };
        match_all?: Record<string, never>;
    };
    limit: number;
    offset: number;
    sort: Array<Record<string, "asc" | "desc">>;
    track_total_hits: boolean;
    options: {
        max_matches: number;
    };
}

export interface ManticoreGameSource {
    id?: number | string;
    name?: string;
    slug?: string;
    summary?: string;
    storyline?: string;
    checksum?: string;
    aggregated_rating?: number;
    aggregated_rating_count?: number;
    category?: number;
    status?: number;
    first_release_date?: number;
    created_at?: number;
    updated_at?: number;
    cover_url?: string;
    genres_names?: string;
    themes_names?: string;
    platforms_names?: string;
    platforms_abbreviations?: string;
    keywords_names?: string;
    num_likes?: number;
    num_views?: number;
    source?: string;
    [key: string]: unknown;
}

export interface ManticoreUserSource {
    user_id?: string;
    username?: string;
    [key: string]: unknown;
}

export interface ManticoreRawHit<TSource> {
    _id: number | string;
    _score?: number;
    _source: TSource;
}

export interface ManticoreValidatedResponse<TSource> {
    took?: number;
    total: number;
    hits: Array<ManticoreRawHit<TSource>>;
}

const GAME_MATCH_FIELD = "name,alternative_names" as const;
const USER_MATCH_FIELD = "username" as const;
const MAX_MATCHES_WINDOW = SEARCH_MAX_OFFSET + SEARCH_MAX_LIMIT;
const DECIMAL_ID_REGEX = /^\d+$/;

@Injectable()
export class SearchService {
    private readonly logger = new Logger(SearchService.name);

    constructor(
        private readonly httpService: HttpService,
        @Optional()
        private readonly configService?: ConfigService,
        @Optional()
        @InjectRepository(GameGenre)
        private readonly genreRepository?: Repository<GameGenre>,
        @Optional()
        @InjectRepository(GameTheme)
        private readonly themeRepository?: Repository<GameTheme>,
        @Optional()
        @InjectRepository(GamePlatform)
        private readonly platformRepository?: Repository<GamePlatform>,
    ) {}

    async searchGames(
        dto: GameSearchRequestDto,
    ): Promise<GameSearchResponseDto> {
        return this.executeGameSearch(dto, { prefixMode: false });
    }

    async autocompleteGames(
        dto: GameAutocompleteRequestDto,
    ): Promise<GameAutocompleteResponseDto> {
        const rawQuery = typeof dto.query === "string" ? dto.query.trim() : "";
        if (rawQuery.length === 0) {
            return {
                data: [],
                total: 0,
            };
        }

        const searchResult = await this.executeGameSearch(
            {
                ...dto,
                query: rawQuery,
                page: SEARCH_AUTOCOMPLETE_PAGE,
                limit: SEARCH_AUTOCOMPLETE_LIMIT,
            },
            { prefixMode: true },
        );

        const names = searchResult.data.items.map((game) => game.name);
        return {
            data: names,
            total: names.length,
        };
    }

    async searchUsers(
        dto: UserSearchRequestDto,
    ): Promise<UserSearchResponseDto> {
        const trimmedQuery =
            typeof dto.query === "string" ? dto.query.trim() : "";
        if (trimmedQuery.length === 0) {
            throw new BadRequestException(
                "query must be a nonblank string of at most 256 characters",
            );
        }

        const { page, limit, offset } = resolveEffectivePagination(dto);
        const engineRequest = this.buildUserSearchRequest(
            trimmedQuery,
            limit,
            offset,
        );

        const engineResponse =
            await this.executeManticoreSearch<ManticoreUserSource>(
                engineRequest,
            );

        const data = this.mapUserResponseData(engineResponse);
        const pagination = this.buildPaginationInfo(
            engineResponse.total,
            limit,
            page,
        );

        return {
            data,
            pagination,
        };
    }

    private async executeGameSearch(
        dto: GameSearchRequestDto,
        options: { prefixMode: boolean },
    ): Promise<GameSearchResponseDto> {
        const { page, limit, offset } = resolveEffectivePagination(dto);
        const resolvedRelations = await this.resolveGameRelationFilters(dto);

        if (resolvedRelations.shortCircuitEmpty) {
            return {
                data: {
                    items: [],
                    took: 0,
                },
                pagination: this.buildPaginationInfo(0, limit, page),
            };
        }

        const engineRequest = this.buildGameSearchRequest(
            dto,
            limit,
            offset,
            options.prefixMode,
            resolvedRelations,
        );

        const engineResponse =
            await this.executeManticoreSearch<ManticoreGameSource>(
                engineRequest,
            );

        const data = this.mapGameResponseData(engineResponse);
        const pagination = this.buildPaginationInfo(
            engineResponse.total,
            limit,
            page,
        );

        return {
            data,
            pagination,
        };
    }

    async resolveGameRelationFilters(
        dto: GameSearchRequestDto,
    ): Promise<ResolvedGameRelationFilters> {
        const hasGenres = Array.isArray(dto.genres) && dto.genres.length > 0;
        const hasThemes = Array.isArray(dto.themes) && dto.themes.length > 0;
        const hasPlatforms =
            Array.isArray(dto.platforms) && dto.platforms.length > 0;

        if (!hasGenres && !hasThemes && !hasPlatforms) {
            return { shortCircuitEmpty: false };
        }

        const [genreIds, themeIds, platformIds] = await Promise.all([
            hasGenres
                ? this.resolveResourceFilterIds(
                      dto.genres!,
                      this.genreRepository,
                      false,
                  )
                : Promise.resolve(undefined),
            hasThemes
                ? this.resolveResourceFilterIds(
                      dto.themes!,
                      this.themeRepository,
                      false,
                  )
                : Promise.resolve(undefined),
            hasPlatforms
                ? this.resolveResourceFilterIds(
                      dto.platforms!,
                      this.platformRepository,
                      true,
                  )
                : Promise.resolve(undefined),
        ]);

        const shortCircuitEmpty =
            (hasGenres && (!genreIds || genreIds.length === 0)) ||
            (hasThemes && (!themeIds || themeIds.length === 0)) ||
            (hasPlatforms && (!platformIds || platformIds.length === 0));

        return {
            genreIds,
            themeIds,
            platformIds,
            shortCircuitEmpty,
        };
    }

    private async resolveResourceFilterIds<T extends ObjectLiteral & { id: number }>(
        rawValues: string[],
        repository: Repository<T> | undefined,
        includeAbbreviation: boolean,
    ): Promise<number[]> {
        const candidateIds = new Set<number>();
        const lowerTokens = new Set<string>();

        for (const rawValue of rawValues) {
            if (typeof rawValue !== "string") {
                continue;
            }
            const trimmed = rawValue.trim();
            if (trimmed.length === 0) {
                continue;
            }
            if (DECIMAL_ID_REGEX.test(trimmed)) {
                const parsedId = Number(trimmed);
                if (Number.isSafeInteger(parsedId) && parsedId > 0) {
                    candidateIds.add(parsedId);
                }
            }
            lowerTokens.add(trimmed.toLowerCase());
        }

        if (candidateIds.size === 0 && lowerTokens.size === 0) {
            return [];
        }

        if (!repository) {
            this.logger.error({
                msg: "Search resource filter repository is not available",
                includeAbbreviation,
            });
            throw new ServiceUnavailableException(
                "Search service is currently unavailable",
            );
        }

        const qb = repository
            .createQueryBuilder("resource")
            .select(["resource.id"]);

        const conditions: string[] = [];
        const params: Record<string, unknown> = {};

        if (candidateIds.size > 0) {
            conditions.push("resource.id IN (:...candidateIds)");
            params.candidateIds = Array.from(candidateIds);
        }

        if (lowerTokens.size > 0) {
            conditions.push("LOWER(resource.name) IN (:...lowerTokens)");
            if (includeAbbreviation) {
                conditions.push(
                    "LOWER(resource.abbreviation) IN (:...lowerTokens)",
                );
            }
            params.lowerTokens = Array.from(lowerTokens);
        }

        qb.where(conditions.join(" OR "), params);

        const rows = await qb.getMany();
        const resolvedSet = new Set<number>();

        for (const row of rows) {
            const numericId =
                typeof row?.id === "number" ? row.id : Number(row?.id);
            if (
                Number.isInteger(numericId) &&
                Number.isSafeInteger(numericId) &&
                numericId > 0
            ) {
                resolvedSet.add(numericId);
            }
        }

        return Array.from(resolvedSet).sort((a, b) => a - b);
    }

    buildGameSearchRequest(
        dto: GameSearchRequestDto,
        limit: number,
        offset: number,
        prefixMode = false,
        resolvedRelations?: ResolvedGameRelationFilters,
    ): ManticoreSearchRequest {
        const must: ManticoreQueryFilter[] = [];
        const rawQuery = typeof dto.query === "string" ? dto.query.trim() : "";

        if (rawQuery.length > 0) {
            const phrase = prefixMode ? `^${rawQuery}*` : `^${rawQuery}`;
            must.push({
                match_phrase: {
                    [GAME_MATCH_FIELD]: phrase,
                },
            });
        }

        if (Array.isArray(dto.category) && dto.category.length > 0) {
            must.push({
                in: {
                    category: dto.category,
                } as ManticoreQueryFilter["in"],
            });
        }

        if (Array.isArray(dto.status) && dto.status.length > 0) {
            must.push({
                in: {
                    status: dto.status,
                } as ManticoreQueryFilter["in"],
            });
        }

        if (
            resolvedRelations?.genreIds &&
            resolvedRelations.genreIds.length > 0
        ) {
            must.push({
                in: {
                    genre_ids: resolvedRelations.genreIds,
                } as ManticoreQueryFilter["in"],
            });
        }

        if (
            resolvedRelations?.themeIds &&
            resolvedRelations.themeIds.length > 0
        ) {
            must.push({
                in: {
                    theme_ids: resolvedRelations.themeIds,
                } as ManticoreQueryFilter["in"],
            });
        }

        if (
            resolvedRelations?.platformIds &&
            resolvedRelations.platformIds.length > 0
        ) {
            must.push({
                in: {
                    platform_ids: resolvedRelations.platformIds,
                } as ManticoreQueryFilter["in"],
            });
        }

        return {
            table: SEARCH_GAMES_TABLE,
            query:
                must.length > 0
                    ? {
                          bool: {
                              must,
                          },
                      }
                    : {
                          match_all: {},
                      },
            limit,
            offset,
            sort: [
                { _score: "desc" },
                { num_views: "desc" },
                { first_release_date: "desc" },
                { id: "asc" },
            ],
            track_total_hits: true,
            options: {
                max_matches: MAX_MATCHES_WINDOW,
            },
        };
    }

    buildUserSearchRequest(
        trimmedQuery: string,
        limit: number,
        offset: number,
    ): ManticoreSearchRequest {
        return {
            table: SEARCH_USERS_TABLE,
            query: {
                match: {
                    [USER_MATCH_FIELD]: `${trimmedQuery}*`,
                },
            },
            limit,
            offset,
            sort: [{ _score: "desc" }, { user_id: "asc" }],
            track_total_hits: true,
            options: {
                max_matches: MAX_MATCHES_WINDOW,
            },
        };
    }

    async executeManticoreSearch<TSource>(
        request: ManticoreSearchRequest,
    ): Promise<ManticoreValidatedResponse<TSource>> {
        const baseUrl =
            this.configService?.get<string>("MANTICORE_URL") ||
            process.env.MANTICORE_URL ||
            SEARCH_DEFAULT_MANTICORE_URL;
        const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

        let rawData: unknown;
        try {
            const response = await firstValueFrom(
                this.httpService.post(`${normalizedBaseUrl}/search`, request, {
                    timeout: SEARCH_ENGINE_TIMEOUT_MS,
                    headers: {
                        "Content-Type": "application/json",
                    },
                }),
            );
            rawData = response?.data;
        } catch (err) {
            throw this.translateEngineError(err, request.table);
        }

        return this.validateAndExtractEngineResponse<TSource>(
            rawData,
            request.table,
        );
    }

    private translateEngineError(
        err: unknown,
        table: SearchEngineTable,
    ): HttpException {
        if (err instanceof HttpException) {
            return err;
        }

        const axiosErr = err as AxiosError | undefined;
        const code = typeof axiosErr?.code === "string" ? axiosErr.code : "";
        const status = axiosErr?.response?.status;
        const message =
            typeof axiosErr?.message === "string" ? axiosErr.message : "";

        const isTimeout =
            code === "ECONNABORTED" ||
            code === "ETIMEDOUT" ||
            status === 504 ||
            status === 408 ||
            /timeout/i.test(message);

        if (isTimeout) {
            this.logger.warn({
                msg: "Manticore search request timed out",
                table,
                code: code || undefined,
                upstreamStatus: status,
            });
            return new GatewayTimeoutException(
                "Search engine request timed out",
            );
        }

        const isUnavailable =
            status === 503 ||
            (!status &&
                (code === "ECONNREFUSED" ||
                    code === "ENOTFOUND" ||
                    code === "ECONNRESET" ||
                    code === "EAI_AGAIN" ||
                    code === "EHOSTUNREACH" ||
                    code === "ENETUNREACH" ||
                    code === "ERR_NETWORK" ||
                    axiosErr?.response === undefined));

        if (isUnavailable) {
            this.logger.error({
                msg: "Manticore search engine unavailable",
                table,
                code: code || undefined,
                upstreamStatus: status,
            });
            return new ServiceUnavailableException(
                "Search service is currently unavailable",
            );
        }

        this.logger.error({
            msg: "Manticore search upstream error",
            table,
            code: code || undefined,
            upstreamStatus: status,
        });
        return new BadGatewayException("Invalid response from search engine");
    }

    private validateAndExtractEngineResponse<TSource>(
        rawData: unknown,
        table: SearchEngineTable,
    ): ManticoreValidatedResponse<TSource> {
        if (
            !rawData ||
            typeof rawData !== "object" ||
            Array.isArray(rawData)
        ) {
            this.logger.error({
                msg: "Malformed Manticore response payload (not an object)",
                table,
            });
            throw new BadGatewayException(
                "Invalid response from search engine",
            );
        }

        const payload = rawData as Record<string, unknown>;

        if (
            payload.error !== undefined &&
            payload.error !== null &&
            payload.error !== ""
        ) {
            this.logger.error({
                msg: "Manticore returned an explicit error response",
                table,
            });
            throw new BadGatewayException(
                "Invalid response from search engine",
            );
        }

        if (payload.timed_out === true) {
            this.logger.error({
                msg: "Manticore search response marked timed_out",
                table,
            });
            throw new BadGatewayException(
                "Invalid response from search engine",
            );
        }

        const hitsContainer = payload.hits;
        if (
            !hitsContainer ||
            typeof hitsContainer !== "object" ||
            Array.isArray(hitsContainer)
        ) {
            this.logger.error({
                msg: "Malformed Manticore response payload (missing hits object)",
                table,
            });
            throw new BadGatewayException(
                "Invalid response from search engine",
            );
        }

        const hitsObj = hitsContainer as Record<string, unknown>;
        const total = hitsObj.total;
        const totalRelation = hitsObj.total_relation;
        const hitsArray = hitsObj.hits;

        if (
            typeof total !== "number" ||
            !Number.isInteger(total) ||
            !Number.isSafeInteger(total) ||
            total < 0 ||
            !Array.isArray(hitsArray)
        ) {
            this.logger.error({
                msg: "Malformed Manticore hits structure",
                table,
            });
            throw new BadGatewayException(
                "Invalid response from search engine",
            );
        }

        if (
            totalRelation !== undefined &&
            totalRelation !== null &&
            totalRelation !== "eq"
        ) {
            this.logger.error({
                msg: "Manticore returned non-exact total_relation",
                table,
                totalRelation,
            });
            throw new BadGatewayException(
                "Invalid response from search engine",
            );
        }

        for (const hit of hitsArray) {
            if (
                !hit ||
                typeof hit !== "object" ||
                Array.isArray(hit) ||
                !(hit as Record<string, unknown>)._source ||
                typeof (hit as Record<string, unknown>)._source !== "object" ||
                Array.isArray((hit as Record<string, unknown>)._source)
            ) {
                this.logger.error({
                    msg: "Malformed Manticore hit entry",
                    table,
                });
                throw new BadGatewayException(
                    "Invalid response from search engine",
                );
            }
        }

        const took =
            typeof payload.took === "number" &&
            Number.isFinite(payload.took) &&
            payload.took >= 0
                ? Math.trunc(payload.took)
                : undefined;

        return {
            took,
            total,
            hits: hitsArray as Array<ManticoreRawHit<TSource>>,
        };
    }

    private mapGameResponseData(
        response: ManticoreValidatedResponse<ManticoreGameSource>,
    ): GameSearchResponseDataDto {
        const items: SearchGameDto[] = response.hits.map((hit) =>
            this.mapSearchGameHit(hit),
        );

        const data: GameSearchResponseDataDto = {
            items,
        };
        if (response.took !== undefined) {
            data.took = response.took;
        }
        return data;
    }

    private mapSearchGameHit(
        hit: ManticoreRawHit<ManticoreGameSource>,
    ): SearchGameDto {
        const source = hit._source;
        const rawId = hit._id ?? source.id;
        const id = typeof rawId === "number" ? rawId : Number(rawId);

        if (
            typeof source.name !== "string" ||
            typeof source.slug !== "string" ||
            !Number.isInteger(id) ||
            !Number.isSafeInteger(id) ||
            id <= 0
        ) {
            this.logger.error({
                msg: "Malformed game hit identity fields",
                table: SEARCH_GAMES_TABLE,
            });
            throw new BadGatewayException(
                "Invalid response from search engine",
            );
        }

        const category = this.toNonNegativeInt(source.category, 0);
        const status = this.toNonNegativeInt(source.status, 0);
        const createdAt = this.toIsoTimestamp(source.created_at);
        const updatedAt = this.toIsoTimestamp(source.updated_at);
        const firstReleaseDate = this.toIsoTimestamp(source.first_release_date);
        const mappedSource =
            typeof source.source === "string" && source.source.trim().length > 0
                ? source.source
                : SEARCH_SOURCE_MANTICORE;

        const game: SearchGameDto = {
            id,
            name: source.name,
            slug: source.slug,
            category,
            status,
            firstReleaseDate,
            createdAt,
            updatedAt,
            source: mappedSource,
        };

        this.assignOptionalString(game, "summary", source.summary);
        this.assignOptionalString(game, "storyline", source.storyline);
        this.assignOptionalString(game, "checksum", source.checksum);
        this.assignOptionalPositiveNumber(
            game,
            "aggregatedRating",
            source.aggregated_rating,
        );
        this.assignOptionalPositiveInteger(
            game,
            "aggregatedRatingCount",
            source.aggregated_rating_count,
        );
        this.assignOptionalString(game, "coverUrl", source.cover_url);
        this.assignOptionalLabelString(
            game,
            "genresNames",
            source.genres_names,
        );
        this.assignOptionalLabelString(
            game,
            "themesNames",
            source.themes_names,
        );
        this.assignOptionalLabelString(
            game,
            "platformsNames",
            source.platforms_names,
        );
        this.assignOptionalLabelString(
            game,
            "platformsAbbreviations",
            source.platforms_abbreviations,
        );
        this.assignOptionalLabelString(
            game,
            "keywordsNames",
            source.keywords_names,
        );
        this.assignOptionalPositiveInteger(game, "numLikes", source.num_likes);
        this.assignOptionalPositiveInteger(game, "numViews", source.num_views);

        return game;
    }

    private mapUserResponseData(
        response: ManticoreValidatedResponse<ManticoreUserSource>,
    ): UserSearchResponseDataDto {
        const items: SearchUserDto[] = response.hits.map((hit) => {
            const source = hit._source;
            if (
                typeof source.user_id !== "string" ||
                source.user_id.trim().length === 0 ||
                typeof source.username !== "string" ||
                source.username.trim().length === 0
            ) {
                this.logger.error({
                    msg: "Malformed user hit identity fields",
                    table: SEARCH_USERS_TABLE,
                });
                throw new BadGatewayException(
                    "Invalid response from search engine",
                );
            }
            return {
                userId: source.user_id,
                username: source.username,
            };
        });

        const data: UserSearchResponseDataDto = {
            items,
        };
        if (response.took !== undefined) {
            data.took = response.took;
        }
        return data;
    }

    buildPaginationInfo(
        totalItems: number,
        limit: number,
        page: number,
    ): SearchPaginationInfoDto {
        const safeTotal = Math.max(0, Math.trunc(totalItems));
        const totalPages =
            safeTotal === 0 ? 0 : Math.ceil(safeTotal / limit);
        const hasNextPage = safeTotal > 0 && page < totalPages;

        return {
            totalItems: safeTotal,
            totalPages,
            hasNextPage,
        };
    }

    private toNonNegativeInt(value: unknown, fallback: number): number {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isInteger(num) && num >= 0) {
            return num;
        }
        return fallback;
    }

    private toIsoTimestamp(unixSeconds: unknown): string {
        const sec =
            typeof unixSeconds === "number" && Number.isFinite(unixSeconds)
                ? unixSeconds
                : Number(unixSeconds ?? 0);
        const validSec = Number.isFinite(sec) && sec >= 0 ? sec : 0;
        return new Date(Math.trunc(validSec) * 1000).toISOString();
    }

    private assignOptionalString<K extends keyof SearchGameDto>(
        target: SearchGameDto,
        key: K,
        value: unknown,
    ): void {
        if (typeof value === "string" && value.length > 0) {
            (target[key] as unknown) = value;
        }
    }

    private assignOptionalLabelString<K extends keyof SearchGameDto>(
        target: SearchGameDto,
        key: K,
        value: unknown,
    ): void {
        if (typeof value === "string" && value.trim().length > 0) {
            const normalized = value
                .split(",")
                .map((part) => part.trim())
                .filter((part) => part.length > 0)
                .join(", ");
            if (normalized.length > 0) {
                (target[key] as unknown) = normalized;
            }
        }
    }

    private assignOptionalPositiveInteger<K extends keyof SearchGameDto>(
        target: SearchGameDto,
        key: K,
        value: unknown,
    ): void {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isInteger(num) && Number.isSafeInteger(num) && num > 0) {
            (target[key] as unknown) = num;
        }
    }

    private assignOptionalPositiveNumber<K extends keyof SearchGameDto>(
        target: SearchGameDto,
        key: K,
        value: unknown,
    ): void {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(num) && num > 0) {
            (target[key] as unknown) = num;
        }
    }
}
