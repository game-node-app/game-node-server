import { Module } from "@nestjs/common";
import { GameService } from "./game.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Game } from "./entities/game.entity";
import { GameAlternativeName } from "./entities/game-alternative-name.entity";
import { GameCollection } from "./entities/game-collection.entity";
import { GameCover } from "./entities/game-cover.entity";
import { GameArtwork } from "./entities/game-artwork.entity";
import { GameScreenshot } from "./entities/game-screenshot.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            Game,
            GameAlternativeName,
            GameCollection,
            GameCover,
            GameArtwork,
            GameScreenshot,
        ]),
    ],
    providers: [GameService],
    exports: [GameService],
})
export class GameModule {}
