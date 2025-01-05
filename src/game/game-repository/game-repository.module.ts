import { forwardRef, Module } from "@nestjs/common";
import { GameRepositoryService } from "./game-repository.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { GameAlternativeName } from "./entities/game-alternative-name.entity";
import { GameCollection } from "./entities/game-collection.entity";
import { GameCover } from "./entities/game-cover.entity";
import { GameArtwork } from "./entities/game-artwork.entity";
import { GameScreenshot } from "./entities/game-screenshot.entity";
import { GameExternalGame } from "./entities/game-external-game.entity";
import { GameFranchise } from "./entities/game-franchise.entity";
import { GameGenre } from "./entities/game-genre.entity";
import { GameLocalization } from "./entities/game-localization.entity";
import { GameMode } from "./entities/game-mode.entity";
import { GamePlatform } from "./entities/game-platform.entity";
import { GameKeyword } from "./entities/game-keyword.entity";
import { GameRepositoryController } from "./game-repository.controller";
import { GameInvolvedCompany } from "./entities/game-involved-company.entity";
import { GameCompany } from "./entities/game-company.entity";
import { GameTheme } from "./entities/game-theme.entity";
import { GameEngine } from "./entities/game-engine.entity";
import { GameEngineLogo } from "./entities/game-engine-logo.entity";
import { GameCompanyLogo } from "./entities/game-company-logo.entity";
import { GamePlayerPerspective } from "./entities/game-player-perspective.entity";
import { GameRepositoryCreateService } from "./game-repository-create.service";
import { StatisticsQueueModule } from "../../statistics/statistics-queue/statistics-queue.module";
import { GameRepositoryCacheService } from './game-repository-cache.service';

/**
 * This is a pretty big module, with lots of dependencies.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            Game,
            GameAlternativeName,
            GameCollection,
            GameCover,
            GameArtwork,
            GameScreenshot,
            GameExternalGame,
            GameFranchise,
            GameGenre,
            GameLocalization,
            GameMode,
            GamePlatform,
            GameKeyword,
            GameInvolvedCompany,
            GameCompany,
            GameCompanyLogo,
            GameTheme,
            GameEngine,
            GameEngineLogo,
            GamePlayerPerspective,
        ]),
        forwardRef(() => StatisticsQueueModule),
    ],
    providers: [GameRepositoryService, GameRepositoryCreateService, GameRepositoryCacheService],
    exports: [GameRepositoryService, GameRepositoryCreateService],
    controllers: [GameRepositoryController],
})
export class GameRepositoryModule {}
