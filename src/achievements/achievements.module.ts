import { Module } from "@nestjs/common";
import { AchievementsService } from "./achievements.service";
import { AchievementsController } from "./achievements.controller";
import { AchievementsQueueService } from './achievements-queue/achievements-queue.service';

@Module({
    controllers: [AchievementsController],
    providers: [AchievementsService, AchievementsQueueService],
})
export class AchievementsModule {}
