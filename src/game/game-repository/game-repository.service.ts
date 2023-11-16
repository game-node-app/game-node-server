import { HttpException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { In, Repository } from "typeorm";
import { GameAlternativeName } from "./entities/game-alternative-name.entity";
import { GameArtwork } from "./entities/game-artwork.entity";
import { GameCollection } from "./entities/game-collection.entity";
import { GameCover } from "./entities/game-cover.entity";
import { GameScreenshot } from "./entities/game-screenshot.entity";
import { PartialGame } from "./game-repository.types";
import { GameFranchise } from "./entities/game-franchise.entity";
import { GameExternalGame } from "./entities/game-external-game.entity";
import { GameLocalization } from "./entities/game-localization.entity";
import { GameMode } from "./entities/game-mode.entity";
import { GameGenre } from "./entities/game-genre.entity";
import { GameKeyword } from "./entities/game-keyword.entity";
import { GamePlatform } from "./entities/game-platform.entity";
import { GameRepositoryRequestDto } from "./dto/game-repository-request.dto";
import { GameInvolvedCompany } from "./entities/game-involved-company.entity";
import { GameTheme } from "./entities/game-theme.entity";
import { GamePlayerPerspective } from "./entities/game-player-perspective.entity";
import { GameEngine } from "./entities/game-engine.entity";
import { GameCompany } from "./entities/game-company.entity";

@Injectable()
export class GameRepositoryService {
    private readonly logger = new Logger(GameRepositoryService.name);

    /**
     * TODO: Separate into multiple services (?).
     * @param gameRepository
     * @param gameAlternativeNameRepository
     * @param gameArtworkRepository
     * @param gameCollectionRepository
     * @param gameCoverRepository
     * @param gameScreenshotRepository
     * @param gameFranchiseRepository
     * @param gameExternalGameRepository
     * @param gameLocalizationRepository
     * @param gameModeRepository
     * @param gameGenreRepository
     * @param gameKeywordRepository
     * @param gamePlatformRepository
     * @param gameInvolvedCompanyRepository
     * @param gameCompanyRepository
     * @param gameThemeRepository
     * @param gamePlayerPerspectiveRepository
     * @param gameEngineRepository
     */
    constructor(
        @InjectRepository(Game)
        private readonly gameRepository: Repository<Game>,
        @InjectRepository(GameAlternativeName)
        private readonly gameAlternativeNameRepository: Repository<GameAlternativeName>,
        @InjectRepository(GameArtwork)
        private readonly gameArtworkRepository: Repository<GameArtwork>,
        @InjectRepository(GameCollection)
        private readonly gameCollectionRepository: Repository<GameCollection>,
        @InjectRepository(GameCover)
        private readonly gameCoverRepository: Repository<GameCover>,
        @InjectRepository(GameScreenshot)
        private readonly gameScreenshotRepository: Repository<GameScreenshot>,
        @InjectRepository(GameFranchise)
        private readonly gameFranchiseRepository: Repository<GameFranchise>,
        @InjectRepository(GameExternalGame)
        private readonly gameExternalGameRepository: Repository<GameExternalGame>,
        @InjectRepository(GameLocalization)
        private readonly gameLocalizationRepository: Repository<GameLocalization>,
        @InjectRepository(GameMode)
        private readonly gameModeRepository: Repository<GameMode>,
        @InjectRepository(GameGenre)
        private readonly gameGenreRepository: Repository<GameGenre>,
        @InjectRepository(GameKeyword)
        private readonly gameKeywordRepository: Repository<GameKeyword>,
        @InjectRepository(GamePlatform)
        private readonly gamePlatformRepository: Repository<GamePlatform>,
        @InjectRepository(GameInvolvedCompany)
        private readonly gameInvolvedCompanyRepository: Repository<GameInvolvedCompany>,
        @InjectRepository(GameCompany)
        private readonly gameCompanyRepository: Repository<GameCompany>,
        @InjectRepository(GameTheme)
        private readonly gameThemeRepository: Repository<GameTheme>,
        @InjectRepository(GamePlayerPerspective)
        private readonly gamePlayerPerspectiveRepository: Repository<GamePlayerPerspective>,
        @InjectRepository(GameEngine)
        private readonly gameEngineRepository: Repository<GameEngine>,
    ) {}

    async findOneByIdWithDto(
        id: number,
        dto?: GameRepositoryRequestDto,
    ): Promise<Game> {
        const result = await this.gameRepository.findOne({
            where: {
                id,
            },
            relations: dto?.relations,
        });
        if (result == undefined) {
            throw new HttpException("Game not found", 404);
        }

        return result;
    }

    async findOneById(id: number): Promise<Game | null> {
        return await this.gameRepository.findOneBy({
            id,
        });
    }

    async findAllByIds(ids: number[]): Promise<Game[]> {
        return this.gameRepository.find({
            where: {
                id: In(ids),
            },
        });
    }

    async findAll(): Promise<[Game[], number]> {
        return this.gameRepository.findAndCount();
    }

    async findAllGamePlatforms(): Promise<GamePlatform[]> {
        return await this.gamePlatformRepository.find();
    }
}
