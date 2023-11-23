import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import {
    FindOptionsRelationByString,
    FindOptionsRelations,
    In,
    Repository,
} from "typeorm";
import { GameGenre } from "./entities/game-genre.entity";
import { GamePlatform } from "./entities/game-platform.entity";
import { GameTheme } from "./entities/game-theme.entity";
import { GameRepositoryFindAllDto } from "./dto/game-repository-find-all.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { BaseFindDto } from "../../utils/base-find.dto";
import { GameRepositoryFindOneDto } from "./dto/game-repository-find-one.dto";

@Injectable()
export class GameRepositoryService {
    private readonly logger = new Logger(GameRepositoryService.name);

    /**
     * @param gameRepository
     * @param gameGenreRepository
     * @param gamePlatformRepository
     * @param gameThemeRepository
     */
    constructor(
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        @InjectRepository(GameGenre)
        private readonly gameGenreRepository: Repository<GameGenre>,
        @InjectRepository(GamePlatform)
        private readonly gamePlatformRepository: Repository<GamePlatform>,
        @InjectRepository(GameTheme)
        private readonly gameThemeRepository: Repository<GameTheme>,
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

    async findAllByIds(
        dto: GameRepositoryFindAllDto,
    ): Promise<TPaginationData<Game>> {
        if (
            dto == undefined ||
            dto.gameIds == undefined ||
            dto.gameIds.length === 0
        ) {
            throw new HttpException("Invalid query.", HttpStatus.BAD_REQUEST);
        }
        const findOptions = buildBaseFindOptions<Game>(dto);
        return this.gameRepository.findAndCount({
            ...findOptions,
            where: {
                id: In(dto?.gameIds),
            },
            relations: dto.relations,
        });
    }

    async findAll(dto: BaseFindDto<Game>): Promise<TPaginationData<Game>> {
        const findOptions = buildBaseFindOptions(dto);
        return this.gameRepository.findAndCount(findOptions);
    }

    async getAllGamePlatforms(): Promise<GamePlatform[]> {
        return await this.gamePlatformRepository.find();
    }

    async getAllGenres(): Promise<GameGenre[]> {
        return await this.gameGenreRepository.find();
    }

    async getAllThemes() {
        return await this.gameThemeRepository.find();
    }
}
