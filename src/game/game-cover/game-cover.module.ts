import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { Game } from "../game-repository/entities/game.entity";
import { GameCover } from "../game-repository/entities/game-cover.entity";
import { GameCoverOption } from "./entities/game-cover-option.entity";
import { UserGameCover } from "./entities/user-game-cover.entity";
import { GameCoverController } from "./game-cover.controller";
import { GameCoverService } from "./game-cover.service";

/**
 * Owns the cover option catalog and per-user choices. Registers every repository
 * the service family needs, so it never imports GameRepositoryModule.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            Game,
            GameCover,
            GameCoverOption,
            UserGameCover,
            Profile,
        ]),
    ],
    controllers: [GameCoverController],
    providers: [GameCoverService],
    exports: [GameCoverService],
})
export class GameCoverModule {}
