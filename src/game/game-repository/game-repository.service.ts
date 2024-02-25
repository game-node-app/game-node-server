import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { DataSource, In, Repository } from "typeorm";
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

    /**
     * @param dataSource
     * @param gameRepository
     */
    constructor(
        private readonly dataSource: DataSource,
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
    ) {}

    async findOneById(
        id: number,
        dto?: GameRepositoryFindOneDto,
    ): Promise<Game> {
        const game = await this.gameRepository.findOne({
            where: {
                id,
            },
            relations: dto?.relations,
        });
        if (!game) {
            throw new HttpException("Game not found.", HttpStatus.NOT_FOUND);
        }
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

        return dto.gameIds
            .map((id) => {
                return gamesMap.get(id);
            })
            .filter((game) => game != undefined) as Game[];
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
}
