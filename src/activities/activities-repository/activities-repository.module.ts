import { Module } from "@nestjs/common";
import { ActivitiesRepositoryService } from "./activities-repository.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import { ActivityStatistics } from "../../statistics/entity/activity-statistics.entity";

@Module({
    imports: [TypeOrmModule.forFeature([Activity, ActivityStatistics])],
    providers: [ActivitiesRepositoryService],
    exports: [ActivitiesRepositoryService],
})
export class ActivitiesRepositoryModule {}
