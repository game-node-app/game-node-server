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
import { AchievementsCodeService } from './achievements-code.service';
import { AchievementsCodeController } from './achievements-code.controller';

@Module({
    imports: [
        TypeOrmModule.forFeature([ObtainedAchievement]),
        BullModule.registerQueue({
            name: ACHIEVEMENTS_QUEUE_NAME,
            defaultJobOptions: {
                removeOnFail: false,
            },
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
