import { forwardRef, Module } from "@nestjs/common";
import { GameAchievementSyncQueueService } from "./game-achievement-sync-queue.service";
import { GameAchievementSyncProcessor } from "./game-achievement-sync.processor";
import { GameAchievementModule } from "../game-achievement.module";
import { BullModule } from "@nestjs/bullmq";
import { GAME_ACHIEVEMENT_SYNC_QUEUE_NAME } from "./game-achievement-sync.constants";
import { seconds } from "@nestjs/throttler";

/**
 * Module responsible for controlling the synchronization of game achievement data.
 * It tracks the completion status of games for users, including whether a game
 * is completed, if the platinum trophy is obtained (for PlayStation games), and the total/obtained achievements.
 */
@Module({
    imports: [
        BullModule.registerQueue({
            name: GAME_ACHIEVEMENT_SYNC_QUEUE_NAME,
            defaultJobOptions: {
                backoff: seconds(5),
                attempts: 5,
            },
        }),
        forwardRef(() => GameAchievementModule),
    ],
    providers: [GameAchievementSyncQueueService, GameAchievementSyncProcessor],
    exports: [GameAchievementSyncQueueService],
})
export class GameAchievementSyncModule {}
