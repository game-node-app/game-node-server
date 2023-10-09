import { Module } from "@nestjs/common";
import { GameService } from "./game.service";
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
import { GameKeyword } from "./game-keyword.entity";

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
        ]),
    ],
    providers: [GameService],
    exports: [GameService],
})
export class GameModule {}
