import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { DataSource, In, Repository } from "typeorm";
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
import { getIconNamesForPlatformAbbreviations } from "./game-repository.utils";
import {
    GameAllowedResource,
    GamePropertyPathToEntityMap,
} from "./create/game-repository-create.constants";
import { Cache } from "@nestjs/cache-manager";

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

    @Cacheable(GameRepositoryService.name, minutes(5))
    async findOneByIdOrFail(
        id: number,
        dto?: GameRepositoryFindOneDto,
    ): Promise<Game> {
        return await this.gameRepository.findOneOrFail({
            where: {
                id,
            },
            relations: dto?.relations,
            relationLoadStrategy: getRelationLoadStrategy(dto?.relations),
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

    @Cacheable(GameRepositoryService.name, minutes(5))
    async findAllByIds(dto: GameRepositoryFindAllDto) {
        if (
            dto == undefined ||
            dto.gameIds == undefined ||
            dto.gameIds.length === 0
        ) {
            throw new HttpException("Invalid query.", HttpStatus.BAD_REQUEST);
        }

        const games = await this.gameRepository.find({
            where: {
                id: In(dto?.gameIds),
            },
            relations: dto.relations,
            relationLoadStrategy: getRelationLoadStrategy(dto?.relations),
        });

        if (games.length === 0) {
            throw new HttpException(
                "No games match provided ids",
                HttpStatus.NOT_FOUND,
            );
        }

        return this.reOrderByIds(dto.gameIds, games);
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
}
