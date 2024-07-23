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
import { AchievementsCodeService } from "./achievements-code.service";
import { AchievementsCodeController } from "./achievements-code.controller";
import { AchievementCode } from "./entities/achievement-code.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([ObtainedAchievement, AchievementCode]),
        BullModule.registerQueue({
            name: ACHIEVEMENTS_QUEUE_NAME,
        }),
        LevelModule,
    ],
    controllers: [AchievementsController, AchievementsCodeController],
    providers: [
        AchievementsService,
        AchievementsQueueService,
        AchievementsQueueProcessor,
        AchievementsCodeService,
    ],
    exports: [AchievementsQueueService],
})
export class AchievementsModule {}
