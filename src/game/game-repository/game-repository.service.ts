import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { DataSource, FindOptionsRelations, In, Repository } from "typeorm";
import { GameGenre } from "./entities/game-genre.entity";
import { GamePlatform } from "./entities/game-platform.entity";
import { GameTheme } from "./entities/game-theme.entity";
import { GameRepositoryFindAllDto } from "./dto/game-repository-find-all.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { BaseFindDto } from "../../utils/base-find.dto";
import { GameRepositoryFindOneDto } from "./dto/game-repository-find-one.dto";
import { GameMode } from "./entities/game-mode.entity";
import { GamePlayerPerspective } from "./entities/game-player-perspective.entity";
import { GameRepositoryFilterDto } from "./dto/game-repository-filter.dto";
import { buildFilterFindOptions } from "./utils/build-filter-find-options";
import { days, minutes } from "@nestjs/throttler";
import { GameExternalGame } from "./entities/game-external-game.entity";
import {
    EGameExternalGameCategory,
    platformAbbreviationToIconMap,
} from "./game-repository.constants";
import { GameExternalStoreDto } from "./dto/game-external-store.dto";
import {
    getIconNameForExternalGameCategory,
    getStoreNameForExternalGameCategory,
} from "./game-repository.utils";

const resourceToEntityMap = {
    platforms: GamePlatform,
    genres: GameGenre,
    themes: GameTheme,
    gameModes: GameMode,
    playerPerspectives: GamePlayerPerspective,
    dlcOf: Game,
};

export type TAllowedResource = keyof typeof resourceToEntityMap;

@Injectable()
export class GameRepositoryService {
    private readonly logger = new Logger(GameRepositoryService.name);
    private readonly maximumAllowedRelationsQuery = 3;

    /**
     * @param dataSource
     * @param gameRepository
     * @param gamePlatformRepository
     * @param gameExternalGameRepository
     */
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        @InjectRepository(GamePlatform)
        private readonly gamePlatformRepository: Repository<GamePlatform>,
        @InjectRepository(GameExternalGame)
        private readonly gameExternalGameRepository: Repository<GameExternalGame>,
    ) {}

    private validateMaximumRelations(
        relations: FindOptionsRelations<Game> | undefined,
    ) {
        if (!relations) return;
        const totalQueriedEntries = Object.entries(relations).filter(
            ([key, value]) => {
                // E.g.: genres: true
                return key != undefined && value;
            },
        ).length;
        if (totalQueriedEntries > this.maximumAllowedRelationsQuery) {
            throw new HttpException(
                `For performance reasons, queries with more than ${this.maximumAllowedRelationsQuery} relations are not allowed. Send multiple requests instead.`,
                HttpStatus.BAD_REQUEST,
            );
        }
    }

    async findOneById(
        id: number,
        dto?: GameRepositoryFindOneDto,
    ): Promise<Game> {
        this.validateMaximumRelations(dto?.relations);

        const game = await this.gameRepository.findOne({
            where: {
                id,
            },
            relations: dto?.relations,
            cache: minutes(5),
            relationLoadStrategy: "query",
        });
        if (!game) {
            throw new HttpException("Game not found.", HttpStatus.NOT_FOUND);
        }

        return game;
    }

    private reOrderByIds(originalIds: number[], unOrderedGames: Game[]) {
        const gamesMap = unOrderedGames.reduce((acc, current) => {
            acc.set(current.id, current);
            return acc;
        }, new Map<number, Game>());

        return originalIds
            .map((id) => {
                return gamesMap.get(id);
            })
            .filter((game) => game != undefined) as Game[];
    }

    async findAllByIds(dto: GameRepositoryFindAllDto) {
        if (
            dto == undefined ||
            dto.gameIds == undefined ||
            dto.gameIds.length === 0
        ) {
            throw new HttpException("Invalid query.", HttpStatus.BAD_REQUEST);
        }
        this.validateMaximumRelations(dto?.relations);

        const games = await this.gameRepository.find({
            where: {
                id: In(dto?.gameIds),
            },
            relations: dto.relations,
            cache: minutes(5),
            relationLoadStrategy: "query",
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
     * Only returns ids for optimization purposes.
     * @param filterDto
     */
    async findAllIdsWithFilters(
        filterDto: GameRepositoryFilterDto,
    ): Promise<number[]> {
        const findOptions = buildBaseFindOptions(filterDto);
        const whereOptions = buildFilterFindOptions(filterDto);
        const games = await this.gameRepository.find({
            ...findOptions,
            where: whereOptions,
            cache: minutes(5),
        });
        if (filterDto.ids) {
            const reorderedGames = this.reOrderByIds(filterDto.ids, games);
            return reorderedGames.map((game) => game.id);
        }

        return games.map((game) => game.id);
    }

    async findGameExternalStores(gameId: number) {
        const externalGames = await this.gameExternalGameRepository.findBy({
            gameId,
        });
        if (externalGames.length === 0) {
            throw new HttpException(
                "Game has no external stores registered",
                HttpStatus.NOT_FOUND,
            );
        }

        const uniqueExternalGamesMap = externalGames.reduce((acc, current) => {
            if (current.category) {
                acc.set(current.category, current);
            }
            return acc;
        }, new Map<number, GameExternalGame>());
        const uniqueExternalGames = Array.from(uniqueExternalGamesMap.values());
        const externalStoreDtos = uniqueExternalGames.map((externalGame) => {
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

        return externalStoreDtos;
    }

    async getResource(resource: TAllowedResource): Promise<any> {
        const resourceAsEntity = resourceToEntityMap[resource];
        if (resourceAsEntity == undefined) {
            throw new HttpException("Resource type not allowed", 400);
        }

        const resourceRepository =
            this.dataSource.getRepository(resourceAsEntity);
        return await resourceRepository.find();
    }

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
        const iconsNames: string[] = [];
        for (const [iconName, platforms] of Object.entries(
            platformAbbreviationToIconMap,
        )) {
            const abbreviationPresent = platformAbbreviations.some(
                (abbreviation) => platforms.includes(abbreviation),
            );
            if (abbreviationPresent) {
                iconsNames.push(iconName);
            }
        }

        return iconsNames;
    }

    async getExternalGamesForGameIds(gameIds: number[]) {
        return this.gameExternalGameRepository.find({
            where: {
                gameId: In(gameIds),
            },
            cache: {
                id: `external-games-ids-${gameIds}`,
                milliseconds: days(1),
            },
        });
    }

    /**
     *
     * @param sourceIds
     * @param category
     */
    async getExternalGamesForSourceIds(
        sourceIds: string[],
        category: EGameExternalGameCategory,
    ) {
        return this.gameExternalGameRepository.find({
            where: {
                uid: In(sourceIds),
                category,
            },
        });
    }
}
