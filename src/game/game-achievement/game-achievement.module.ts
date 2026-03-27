import { forwardRef, Module } from "@nestjs/common";
import { ExternalGameModule } from "../external-game/external-game.module";
import { GameAchievementService } from "./game-achievement.service";
import { GameAchievementController } from "./game-achievement.controller";
import { SteamSyncModule } from "../../sync/steam/steam-sync.module";
import { ConnectionsModule } from "../../connection/connections.module";
import { PsnSyncModule } from "../../sync/psn/psn-sync.module";
import { XboxSyncModule } from "../../sync/xbox/xbox-sync.module";
import { GameAchievementV2Controller } from "./game-achievement-v2.controller";
import { GameRepositoryModule } from "../game-repository/game-repository.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ObtainedGameAchievement } from "./entity/obtained-game-achievement.entity";
import { GameAchievementObtainedService } from "./game-achievement-obtained.service";
import { ObtainedGameAchievementActivity } from "./entity/obtained-game-achievement-activity.entity";
import { GameAchievementActivityService } from "./game-achievement-activity.service";
import { ActivitiesQueueModule } from "../../activities/activities-queue/activities-queue.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            ObtainedGameAchievement,
            ObtainedGameAchievementActivity,
        ]),
        ExternalGameModule,
        SteamSyncModule,
        PsnSyncModule,
        XboxSyncModule,
        forwardRef(() => ConnectionsModule),
        GameRepositoryModule,
        forwardRef(() => ActivitiesQueueModule),
    ],
    providers: [
        GameAchievementService,
        GameAchievementObtainedService,
        GameAchievementActivityService,
    ],
    exports: [
        GameAchievementService,
        GameAchievementObtainedService,
        GameAchievementActivityService,
    ],
    controllers: [GameAchievementController, GameAchievementV2Controller],
})
export class GameAchievementModule {}
