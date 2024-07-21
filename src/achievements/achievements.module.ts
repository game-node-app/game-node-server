import { Module } from "@nestjs/common";
import { AchievementsService } from "./achievements.service";
import { AchievementsController } from "./achievements.controller";
import { AchievementsQueueService } from "./achievements-queue/achievements-queue.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { AchievementsQueueProcessor } from "./achievements-queue/achievements-queue.processor";
import { BullModule } from "@nestjs/bullmq";
import { ACHIEVEMENTS_QUEUE_NAME } from "./achievements-queue/achievements-queue.constants";
import { LevelModule } from "../level/level.module";
import { BullBoardModule } from "@bull-board/nestjs";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";

@Module({
    imports: [
        TypeOrmModule.forFeature([ObtainedAchievement]),
        BullModule.registerQueue({
            name: ACHIEVEMENTS_QUEUE_NAME,
            defaultJobOptions: {
                removeOnFail: false,
            },
        }),
        BullBoardModule.forFeature({
            name: ACHIEVEMENTS_QUEUE_NAME,
            adapter: BullMQAdapter,
        }),
        LevelModule,
    ],
    controllers: [AchievementsController],
    providers: [
        AchievementsService,
        AchievementsQueueService,
        AchievementsQueueProcessor,
    ],
    exports: [AchievementsQueueService],
})
export class AchievementsModule {}
