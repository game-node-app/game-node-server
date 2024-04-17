import { Module } from "@nestjs/common";
import { ActivitiesRepositoryService } from "./activities-repository.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import { StatisticsQueueModule } from "../../statistics/statistics-queue/statistics-queue.module";

@Module({
    imports: [TypeOrmModule.forFeature([Activity]), StatisticsQueueModule],
    providers: [ActivitiesRepositoryService],
    exports: [ActivitiesRepositoryService],
})
export class ActivitiesRepositoryModule {}
