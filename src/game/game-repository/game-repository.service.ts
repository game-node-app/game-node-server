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
     * @param gameRepository
     */
    constructor(
        private readonly dataSource: DataSource,
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
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
                `For performance reasons, queries with more than ${this.maximumAllowedRelationsQuery} relations are not allowed.`,
                HttpStatus.BAD_REQUEST,
            );
        }
    }

    async findOneById(
        id: number,
        dto?: GameRepositoryFindOneDto,
    ): Promise<Game> {
        this.validateMaximumRelations(dto?.relations);

        let cacheKey = `gr-find-one-${id}`;
        if (dto) {
            cacheKey = `${cacheKey}-${JSON.stringify(dto)}`;
        }
        try {
            const gameInCache = await this.cacheManager.get<Game>(cacheKey);
            if (gameInCache) return gameInCache;
        } catch (err) {}

        const game = await this.gameRepository.findOne({
            where: {
                id,
            },
            relations: dto?.relations,
        });
        if (!game) {
            throw new HttpException("Game not found.", HttpStatus.NOT_FOUND);
        }

        this.cacheManager
            .set(cacheKey, game, minutes(5))
            .then()
            .catch((err) => this.logger.error(err));

        return game;
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

        const cacheKey = JSON.stringify(dto);
        try {
            const gamesInCache = await this.cacheManager.get<Game[]>(cacheKey);
            if (gamesInCache) return gamesInCache;
        } catch (err) {}

        const games = await this.gameRepository.find({
            where: {
                id: In(dto?.gameIds),
            },
            relations: dto.relations,
        });

        if (games.length === 0) {
            throw new HttpException(
                "No games match provided ids",
                HttpStatus.NOT_FOUND,
            );
        }

        const gamesMap = games.reduce((acc, current) => {
            acc.set(current.id, current);
            return acc;
        }, new Map<number, Game>());

        const filteredGames = dto.gameIds
            .map((id) => {
                return gamesMap.get(id);
            })
            .filter((game) => game != undefined) as Game[];

        this.cacheManager
            .set(cacheKey, filteredGames, minutes(10))
            .then()
            .catch((err) => this.logger.error(err));

        return filteredGames;
    }

    async findAll(dto: BaseFindDto<Game>): Promise<TPaginationData<Game>> {
        const findOptions = buildBaseFindOptions(dto);
        return this.gameRepository.findAndCount(findOptions);
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
