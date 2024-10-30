import { Module } from "@nestjs/common";
import { GameFilterService } from "./game-filter.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameExclusion } from "./entity/game-exclusion.entity";
import { GameRepositoryModule } from "../game-repository/game-repository.module";

/**
 * The game filter module is responsible for issuing 'exclusions' for certain games.
 * These would then be excluded from front-facing content,
 * like the explore screen, trending games and activity list.
 * The games (and content related to it) will still be accessible in the game's
 * info page (hopefully only there).
 */
@Module({
    imports: [TypeOrmModule.forFeature([GameExclusion]), GameRepositoryModule],
    providers: [GameFilterService],
    exports: [GameFilterService],
})
export class GameFilterModule {}
