import { BullModule } from "@nestjs/bull";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProfileModule } from "src/profile/profile.module";
import { Activity } from "../activities-repository/entities/activity.entity";
import { ActivitiesQueueProcessor } from "./activities-queue-processor";
import { ActivitiesQueueService } from "./activities-queue.service";
import { ActivitiesRepositoryModule } from "../activities-repository/activities-repository.module";

@Module({
    imports: [
        ActivitiesRepositoryModule,
        BullModule.registerQueue({
            name: "activities",
        }),
        ProfileModule,
    ],
    providers: [ActivitiesQueueService, ActivitiesQueueProcessor],
    exports: [ActivitiesQueueService],
})
export class ActivitiesQueueModule {}
