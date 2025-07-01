import { Module } from "@nestjs/common";
import { ExternalGameModule } from "../external-game/external-game.module";
import { GameAchievementService } from "./game-achievement.service";
import { GameAchievementController } from "./game-achievement.controller";
import { SteamSyncModule } from "../../sync/steam/steam-sync.module";
import { BullModule } from "@nestjs/bullmq";
import { GAME_ACHIEVEMENT_SYNC_QUEUE_NAME } from "./sync/game-achievement-sync.constants";
import { seconds } from "@nestjs/throttler";
import { GameAchievementSyncQueueService } from "./sync/game-achievement-sync-queue.service";
import { GameAchievementSyncProcessor } from "./sync/game-achievement-sync.processor";
import { ConnectionsModule } from "../../connections/connections.module";

@Module({
    imports: [
        BullModule.registerQueue({
            name: GAME_ACHIEVEMENT_SYNC_QUEUE_NAME,
            defaultJobOptions: {
                backoff: seconds(5),
                attempts: 5,
            },
        }),
        ExternalGameModule,
        SteamSyncModule,
        ConnectionsModule,
    ],
    providers: [
        GameAchievementService,
        GameAchievementSyncQueueService,
        GameAchievementSyncProcessor,
    ],
    controllers: [GameAchievementController],
})
export class GameAchievementModule {}
