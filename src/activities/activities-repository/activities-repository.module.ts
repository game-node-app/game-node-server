import { Module } from "@nestjs/common";
import { ActivitiesRepositoryService } from "./activities-repository.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";

@Module({
    imports: [TypeOrmModule.forFeature([Activity])],
    providers: [ActivitiesRepositoryService],
    exports: [ActivitiesRepositoryService],
})
export class ActivitiesRepositoryModule {}
