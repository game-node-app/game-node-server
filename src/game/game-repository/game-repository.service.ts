import {
    BadRequestException,
    HttpException,
    HttpStatus,
    Injectable,
    Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { DataSource, FindOptionsRelations, In, Repository } from "typeorm";
import { GamePlatform } from "./entities/game-platform.entity";
import { GameRepositoryFindAllDto } from "./dto/game-repository-find-all.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { BaseFindDto } from "../../utils/base-find.dto";
import { GameRepositoryFindOneDto } from "./dto/game-repository-find-one.dto";
import { GameRepositoryFilterDto } from "./dto/game-repository-filter.dto";
import { GameExternalStoreDto } from "./dto/game-external-store.dto";
import { toMap } from "../../utils/toMap";
import { getRelationLoadStrategy } from "../../utils/getRelationLoadStrategy";
import { ExternalGameService } from "../external-game/external-game.service";
import {
    getIconNameForExternalGameCategory,
    getStoreNameForExternalGameCategory,
} from "../external-game/external-game.utils";
import { buildGameFilterFindOptions } from "./utils/build-game-filter-find-options";
import { Cacheable } from "../../utils/cacheable";
import { hours, minutes } from "@nestjs/throttler";
import {
    getIconNamesForPlatformAbbreviations,
    getRelationsCacheKey,
} from "./game-repository.utils";
import {
    GameAllowedResource,
    GamePropertyPathToEntityMap,
} from "./create/game-repository-create.constants";
import { Cache } from "@nestjs/cache-manager";
import {
    FindGamesByCollectionTypeRequestDto,
    GameRepositoryCollectionType,
} from "./dto/game-repository-collection.dto";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import { getPreviousDate } from "../../statistics/statistics.utils";
import { MATURE_THEME_ID } from "../game-filter/game-filter.constants";
import { EGameCategory } from "./game-repository.constants";

dayjs.extend(utc);

const RELEASE_COLLECTION_CATEGORIES = [
    EGameCategory.Main,
    EGameCategory.Remaster,
    EGameCategory.Remake,
    EGameCategory.DlcAddon,
    EGameCategory.Expansion,
    EGameCategory.StandaloneExpansion,
];

// Lean collection projection: only the fields the release strip and calendar render.
const COLLECTION_GAME_FIELDS = [
    "id",
    "name",
    "slug",
    "category",
    "status",
    "firstReleaseDate",
    "summary",
].map((field) => `game.${field}`);
const COLLECTION_COVER_FIELDS = [
    "id",
    "imageId",
    "url",
    "width",
    "height",
    "gameId",
].map((field) => `cover.${field}`);
const COLLECTION_PLATFORM_FIELDS = ["id", "name", "abbreviation"].map(
    (field) => `platforms.${field}`,
);

@Injectable()
export class GameRepositoryService {
    private readonly logger = new Logger(GameRepositoryService.name);

    /**
     * @param dataSource
     * @param gamePlatformRepository
     * @param externalGameService
     * @param gameRepository
     */
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(GamePlatform)
        private readonly gamePlatformRepository: Repository<GamePlatform>,
        private readonly externalGameService: ExternalGameService,
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        private readonly cacheManager: Cache,
    ) {}

    async findOneByIdOrFail(
        id: number,
        dto?: GameRepositoryFindOneDto,
    ): Promise<Game> {
        const cacheKey = this.gameCacheKey(id, dto?.relations);
        const cached = await this.readCachedGames([cacheKey]);
        // The copy keeps callers from mutating an object still referenced by an in-memory cache.
        if (cached[0]) return { ...cached[0] };

        const game = await this.gameRepository.findOneOrFail({
            where: {
                id,
            },
            relations: dto?.relations,
            relationLoadStrategy: getRelationLoadStrategy(dto?.relations),
        });
        this.writeCachedGames([game], dto?.relations);
        return game;
    }

    private gameCacheKey(
        gameId: number,
        relations?: FindOptionsRelations<Game>,
    ): string {
        return `game-repo:v1:${gameId}:${getRelationsCacheKey(relations)}`;
    }

    /** Fail-open: any cache error reads as a miss so the database still answers. */
    private async readCachedGames(
        cacheKeys: string[],
    ): Promise<Array<Game | null>> {
        try {
            return await this.cacheManager.mget<Game>(cacheKeys);
        } catch (error) {
            this.logger.warn(`Game cache read failed: ${error}`);
            return [];
        }
    }

    private writeCachedGames(
        games: Game[],
        relations?: FindOptionsRelations<Game>,
    ) {
        if (games.length === 0) return;

        this.cacheManager
            .mset(
                games.map((game) => ({
                    key: this.gameCacheKey(game.id, relations),
                    // Stored apart from the returned row so no caller can mutate the cached object.
                    value: { ...game },
                    ttl: minutes(5),
                })),
            )
            .catch((error) => {
                this.logger.warn(`Game cache write failed: ${error}`);
            });
    }

    private reOrderByIds(originalIds: number[], unOrderedGames: Game[]) {
        const gamesMap = toMap(unOrderedGames, "id");

        return originalIds
            .map((id) => {
                return gamesMap.get(id);
            })
            .filter((game) => game != undefined) as Game[];
    }

    async findAllByIds(dto: GameRepositoryFindAllDto): Promise<Game[]> {
        if (
            dto == undefined ||
            dto.gameIds == undefined ||
            dto.gameIds.length === 0
        ) {
            throw new HttpException("Invalid query.", HttpStatus.BAD_REQUEST);
        }

        const gameIds = [...new Set(dto.gameIds)];
        const cacheKeys = gameIds.map((gameId) =>
            this.gameCacheKey(gameId, dto.relations),
        );
        const cachedGames = await this.readCachedGames(cacheKeys);
        const gamesById = new Map<number, Game>();
        const missedIds: number[] = [];

        gameIds.forEach((gameId, index) => {
            const cached = cachedGames[index];
            if (cached) gamesById.set(gameId, { ...cached });
            else missedIds.push(gameId);
        });

        if (missedIds.length > 0) {
            const missedGames = await this.gameRepository.find({
                where: {
                    id: In(missedIds),
                },
                relations: dto.relations,
                relationLoadStrategy: getRelationLoadStrategy(dto.relations),
            });

            for (const game of missedGames) {
                gamesById.set(game.id, game);
            }
            this.writeCachedGames(missedGames, dto.relations);
        }

        if (gamesById.size === 0) {
            throw new HttpException(
                "No games match provided ids",
                HttpStatus.NOT_FOUND,
            );
        }

        return this.reOrderByIds(gameIds, Array.from(gamesById.values()));
    }

    /**
     * Genres of the given games without loading the game rows.
     * Uncached on purpose: callers pass user-specific sets of game ids.
     */
    public async findGameGenresByIds(gameIds: number[]) {
        const rows = await this.gameRepository
            .createQueryBuilder("game")
            .innerJoin("game.genres", "genre")
            .select("game.id", "gameId")
            .addSelect("genre.id", "genreId")
            .addSelect("genre.name", "genreName")
            .where("game.id IN (:...gameIds)", { gameIds })
            .getRawMany<{
                gameId: string | number;
                genreId: string | number;
                genreName: string | null;
            }>();

        // MySQL returns bigint columns as strings.
        return rows.map((row) => ({
            gameId: Number(row.gameId),
            genreId: Number(row.genreId),
            genreName: row.genreName,
        }));
    }

    async findAll(dto: BaseFindDto<Game>): Promise<TPaginationData<Game>> {
        const findOptions = buildBaseFindOptions(dto);
        return this.gameRepository.findAndCount(findOptions);
    }

    /**
     * @warning This operation can be quite expensive.
     * @param filterDto
     */
    @Cacheable(GameRepositoryService.name, minutes(5))
    async findAllIdsWithFilters(
        filterDto: GameRepositoryFilterDto,
    ): Promise<Game[]> {
        const findOptions = buildBaseFindOptions(filterDto);
        const whereOptions = buildGameFilterFindOptions(filterDto);

        const games = await this.gameRepository.find({
            ...findOptions,
            where: whereOptions,
        });

        if (filterDto.ids) {
            return this.reOrderByIds(filterDto.ids, games);
        }

        return games;
    }

    @Cacheable(GameRepositoryService.name, hours(1))
    async findGameExternalStores(gameId: number) {
        const externalGames = await this.externalGameService.findAllForGameId([
            gameId,
        ]);
        if (externalGames.length === 0) {
            throw new HttpException(
                "Game has no external stores registered",
                HttpStatus.NOT_FOUND,
            );
        }

        const uniqueExternalGamesMap = toMap(externalGames, "category");

        const uniqueExternalGames = Array.from(uniqueExternalGamesMap.values());

        return uniqueExternalGames.map((externalGame) => {
            const icon = getIconNameForExternalGameCategory(
                externalGame.category?.valueOf(),
            );
            const storeName = getStoreNameForExternalGameCategory(
                externalGame.category?.valueOf(),
            );
            const storeDto: GameExternalStoreDto = {
                ...externalGame,
                icon,
                storeName,
            };

            return storeDto;
        });
    }

    @Cacheable(GameRepositoryService.name, hours(1))
    async getResource(resource: GameAllowedResource): Promise<any> {
        const resourceAsEntity = GamePropertyPathToEntityMap[resource];
        if (resourceAsEntity == undefined) {
            throw new HttpException("Resource type not allowed", 400);
        }

        /**
         * Do not allow fetching games through this method
         */
        if (resourceAsEntity instanceof Game) {
            throw new HttpException("Resource type not allowed", 400);
        }

        const resourceRepository =
            this.dataSource.getRepository(resourceAsEntity);
        return await resourceRepository.find();
    }

    async getGamePlatformsMap<T extends "id" | "name" | "abbreviation">(
        identifier: T,
    ) {
        const platforms: GamePlatform[] = await this.getResource("platforms");

        return toMap(platforms, identifier);
    }

    @Cacheable(GameRepositoryService.name, minutes(30))
    async getIconsNamesForPlatforms(gameId: number) {
        const platforms = await this.gamePlatformRepository.find({
            where: {
                games: {
                    id: gameId,
                },
            },
        });
        if (platforms.length === 0) return [];
        const platformAbbreviations = platforms.map(
            (platform) => platform.abbreviation,
        );
        return getIconNamesForPlatformAbbreviations(platformAbbreviations);
    }

    public async findGamesByCollectionType(
        dto: FindGamesByCollectionTypeRequestDto,
    ): Promise<TPaginationData<Game>> {
        const { from, to } = this.resolveCollectionBounds(dto);
        const relations = dto.relations ?? {};
        const { skip, take } = buildBaseFindOptions(dto);
        // Omitted bounds roll at UTC midnight, so the current day is part of the key.
        const dayBucket =
            dto.from && dto.to ? "fixed" : dayjs().utc().format("YYYY-MM-DD");
        const cacheKey = [
            "game-repo:collection:v1",
            dto.collectionType,
            dto.from ?? "default",
            dto.to ?? "default",
            dayBucket,
            skip,
            take,
            getRelationsCacheKey(relations),
        ].join(":");

        try {
            const cached =
                await this.cacheManager.get<TPaginationData<Game>>(cacheKey);
            if (cached) return cached;
        } catch (error) {
            this.logger.warn(`Collection cache read failed: ${error}`);
        }

        const query = this.gameRepository
            .createQueryBuilder("game")
            .select(COLLECTION_GAME_FIELDS)
            .where(
                "NOT EXISTS (SELECT 1 FROM game_themes_game_theme mature WHERE mature.gameId = game.id AND mature.gameThemeId = :matureThemeId)",
                { matureThemeId: MATURE_THEME_ID },
            )
            .andWhere("game.category IN (:...categories)", {
                categories: RELEASE_COLLECTION_CATEGORIES,
            })
            .andWhere("game.firstReleaseDate >= :from", { from })
            .orderBy("game.firstReleaseDate", "ASC")
            .skip(skip)
            .take(take);

        if (to) {
            query.andWhere("game.firstReleaseDate <= :to", { to });
        }

        for (const [relation, value] of Object.entries(relations)) {
            if (!value) continue;

            if (relation === "cover") {
                query
                    .leftJoin("game.cover", "cover")
                    .addSelect(COLLECTION_COVER_FIELDS);
            } else if (relation === "platforms") {
                query
                    .leftJoin("game.platforms", "platforms")
                    .addSelect(COLLECTION_PLATFORM_FIELDS);
            } else {
                // shortcut: extra relations only load their top level, upgrade if a caller nests them.
                query.leftJoinAndSelect(`game.${relation}`, relation);
            }
        }

        const result = await query.getManyAndCount();

        this.cacheManager.set(cacheKey, result, minutes(15)).catch((error) => {
            this.logger.warn(`Collection cache write failed: ${error}`);
        });

        return result;
    }

    private resolveCollectionBounds(dto: FindGamesByCollectionTypeRequestDto): {
        from: Date;
        to?: Date;
    } {
        const parse = (value: string | undefined, field: "from" | "to") => {
            if (value === undefined) return undefined;

            const parsed = dayjs.utc(value);
            if (!parsed.isValid()) {
                throw new BadRequestException(`Invalid '${field}' date.`);
            }
            return parsed.toDate();
        };

        const from = parse(dto.from, "from");
        const to = parse(dto.to, "to");
        if (from && to && from.getTime() > to.getTime()) {
            throw new BadRequestException(
                "'from' must be before or equal to 'to'.",
            );
        }

        switch (dto.collectionType) {
            case GameRepositoryCollectionType.UPCOMING:
                return {
                    from: from ?? dayjs().utc().startOf("day").toDate(),
                    to,
                };
            case GameRepositoryCollectionType.RECENTLY_RELEASED:
                return {
                    from: from ?? getPreviousDate(30),
                    to: to ?? dayjs().utc().endOf("day").toDate(),
                };
            default:
                throw new BadRequestException("Invalid collection type.");
        }
    }
}
