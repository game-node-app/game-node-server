import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
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
import { buildFilterFindOptions } from "../../sync/igdb/utils/build-filter-find-options";
import { platformAbbreviationToIconMap } from "./game-repository.utils";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { minutes } from "@nestjs/throttler";

const resourceToEntityMap = {
    platforms: GamePlatform,
    genres: GameGenre,
    themes: GameTheme,
    gameModes: GameMode,
    playerPerspectives: GamePlayerPerspective,
};

export type TAllowedResource = keyof typeof resourceToEntityMap;

@Injectable()
export class GameRepositoryService {
    private readonly logger = new Logger(GameRepositoryService.name);
    private readonly maximumAllowedRelationsQuery = 3;

    /**
     * @param dataSource
     * @param cacheManager
     * @param gameRepository
     */
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
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
        });
        if (!game) {
            throw new HttpException("Game not found.", HttpStatus.NOT_FOUND);
        }

        return game;
    }

    private reOrderByIds(originalIds: number[], games: Game[]) {
        const gamesMap = games.reduce((acc, current) => {
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
        });

        if (games.length === 0) {
            throw new HttpException(
                "No games match provided ids",
                HttpStatus.NOT_FOUND,
            );
        }

        const reorderedGames = this.reOrderByIds(dto.gameIds, games);

        return reorderedGames;
    }

    async findAll(dto: BaseFindDto<Game>): Promise<TPaginationData<Game>> {
        const findOptions = buildBaseFindOptions(dto);
        return this.gameRepository.findAndCount(findOptions);
    }

    async findAllByIdsInWithFilter(
        gameIds: number[],
        filterDto?: GameRepositoryFilterDto,
    ): Promise<TPaginationData<Game>> {
        const whereOptions = buildFilterFindOptions(filterDto);
        /**
         * Do not use 'skip' and 'take' here, because the order of returned elements will be lost.
         */
        const [games, totalGames] = await this.gameRepository.findAndCount({
            where: {
                ...whereOptions,
                id: In(gameIds),
            },
        });
        const reOrderedGames = this.reOrderByIds(gameIds, games);

        const offset = filterDto?.offset || 0;
        const limit = filterDto?.limit || 20;
        const slicedGames = reOrderedGames.slice(offset, offset + limit);
        return [slicedGames, totalGames];
    }

    async findAllWithFilter(filterDto: GameRepositoryFilterDto) {
        const findOptions = buildBaseFindOptions(filterDto);
        const whereOptions = buildFilterFindOptions(filterDto);
        return await this.gameRepository.findAndCount({
            ...findOptions,
            where: whereOptions,
        });
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

    getIconNamesForPlatformAbbreviations(platformAbbreviations: string[]) {
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
}
