import { forwardRef, Module } from "@nestjs/common";
import { AchievementsService } from "./achievements.service";
import { AchievementsController } from "./achievements.controller";
import { AchievementsQueueService } from "./achievements-queue/achievements-queue.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { AchievementsQueueProcessor } from "./achievements-queue/achievements-queue.processor";
import { BullModule } from "@nestjs/bullmq";
import {
    ACHIEVEMENTS_BACKFILL_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_NAME,
} from "./achievements-queue/achievements-queue.constants";
import { LevelModule } from "../level/level.module";
import { AchievementsCodeService } from "./achievements-code.service";
import { AchievementsCodeController } from "./achievements-code.controller";
import { AchievementCode } from "./entities/achievement-code.entity";
import { AchievementsV2Controller } from "./v2/achievements-v2.controller";
import { AchievementDefinition } from "./entities/achievement-definition.entity";
import { AchievementEvent } from "./entities/achievement-event.entity";
import { AchievementTier } from "./entities/achievement-tier.entity";
import { AchievementProgress } from "./entities/achievement-progress.entity";
import { AchievementsProgressService } from "./achievements-progress.service";
import { AchievementsAdminService } from "./achievements-admin.service";
import { AchievementsAdminController } from "./achievements-admin.controller";
import { AchievementsBackfillProcessor } from "./achievements-queue/achievements-backfill.processor";
import { ActivitiesQueueModule } from "../activities/activities-queue/activities-queue.module";

/**
 * This module is responsible for providing our internal achievements system, which allows users to earn achievements for completing certain actions on the platform.
 * It was renamed to "Feats" in the frontend to avoid confusion with external achievements from platforms like Steam.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([
            ObtainedAchievement,
            AchievementCode,
            AchievementDefinition,
            AchievementEvent,
            AchievementTier,
            AchievementProgress,
        ]),
        BullModule.registerQueue(
            {
                name: ACHIEVEMENTS_QUEUE_NAME,
            },
            {
                name: ACHIEVEMENTS_BACKFILL_QUEUE_NAME,
            },
        ),
        LevelModule,
        // Activities depend on reviews, which produce achievement jobs
        forwardRef(() => ActivitiesQueueModule),
    ],
    controllers: [
        AchievementsController,
        AchievementsCodeController,
        AchievementsV2Controller,
        AchievementsAdminController,
    ],

    providers: [
        AchievementsService,
        AchievementsQueueService,
        AchievementsQueueProcessor,
        AchievementsBackfillProcessor,
        AchievementsCodeService,
        AchievementsProgressService,
        AchievementsAdminService,
    ],
    exports: [AchievementsQueueService],
})
export class AchievementsModule {}
