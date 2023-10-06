import { Module } from "@nestjs/common";
import { ActivitiesCrudService } from "./activities-crud.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Activity } from "../entities/activity.entity";

@Module({
    imports: [TypeOrmModule.forFeature([Activity])],
    providers: [ActivitiesCrudService],
    exports: [ActivitiesCrudService],
})
export class ActivitiesCrudModule {}
