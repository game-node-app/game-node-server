import { forwardRef, Module } from "@nestjs/common";
import { ExternalGameModule } from "../external-game/external-game.module";
import { GameAchievementService } from "./game-achievement.service";
import { GameAchievementController } from "./game-achievement.controller";
import { SteamSyncModule } from "../../sync/steam/steam-sync.module";
import { BullModule } from "@nestjs/bullmq";
import { GAME_ACHIEVEMENT_SYNC_QUEUE_NAME } from "./sync/game-achievement-sync.constants";
import { seconds } from "@nestjs/throttler";
import { ConnectionsModule } from "../../connection/connections.module";
import { PsnSyncModule } from "../../sync/psn/psn-sync.module";
import { XboxSyncModule } from "../../sync/xbox/xbox-sync.module";
import { GameAchievementV2Controller } from "./game-achievement-v2.controller";
import { GameRepositoryModule } from "../game-repository/game-repository.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ObtainedGameAchievement } from "./entity/obtained-game-achievement.entity";
import { GameAchievementObtainedService } from "./game-achievement-obtained.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([ObtainedGameAchievement]),

        ExternalGameModule,
        SteamSyncModule,
        PsnSyncModule,
        XboxSyncModule,
        forwardRef(() => ConnectionsModule),
        GameRepositoryModule,
    ],
    providers: [GameAchievementService, GameAchievementObtainedService],
    exports: [GameAchievementService, GameAchievementObtainedService],
    controllers: [GameAchievementController, GameAchievementV2Controller],
})
export class GameAchievementModule {}
