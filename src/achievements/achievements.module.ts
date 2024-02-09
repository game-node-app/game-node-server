import { Module } from "@nestjs/common";
import { AchievementsService } from "./achievements.service";
import { AchievementsController } from "./achievements.controller";
import { AchievementsQueueService } from "./achievements-queue/achievements-queue.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { AchievementsQueueProcessor } from "./achievements-queue/achievements-queue.processor";
import { BullModule } from "@nestjs/bull";
import { ACHIEVEMENTS_QUEUE_NAME } from "./achievements-queue/achievements-queue.constants";

@Module({
    imports: [
        TypeOrmModule.forFeature([ObtainedAchievement]),
        BullModule.registerQueue({
            name: ACHIEVEMENTS_QUEUE_NAME,
            defaultJobOptions: {
                removeOnFail: false,
            },
        }),
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
