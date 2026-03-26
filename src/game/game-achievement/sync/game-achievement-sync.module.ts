import { Module } from "@nestjs/common";
import { GameAchievementSyncQueueService } from "./game-achievement-sync-queue.service";
import { GameAchievementSyncProcessor } from "./game-achievement-sync.processor";
import { GameAchievementModule } from "../game-achievement.module";
import { BullModule } from "@nestjs/bullmq";
import { GAME_ACHIEVEMENT_SYNC_QUEUE_NAME } from "./game-achievement-sync.constants";
import { seconds } from "@nestjs/throttler";

@Module({
    imports: [
        BullModule.registerQueue({
            name: GAME_ACHIEVEMENT_SYNC_QUEUE_NAME,
            defaultJobOptions: {
                backoff: seconds(5),
                attempts: 5,
            },
        }),
        GameAchievementModule,
    ],
    providers: [GameAchievementSyncQueueService, GameAchievementSyncProcessor],
    exports: [GameAchievementSyncQueueService],
})
export class GameAchievementSyncModule {}
