import { Module } from "@nestjs/common";
import { AchievementsService } from "./achievements.service";
import { AchievementsController } from "./achievements.controller";
import { AchievementsQueueService } from "./achievements-queue/achievements-queue.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";

@Module({
    imports: [TypeOrmModule.forFeature([ObtainedAchievement])],
    controllers: [AchievementsController],
    providers: [AchievementsService, AchievementsQueueService],
})
export class AchievementsModule {}
