import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ProfileModule } from "../../profile/profile.module";
import { ActivitiesQueueProcessor } from "./activities-queue-processor";
import { ActivitiesQueueService } from "./activities-queue.service";
import { ActivitiesRepositoryModule } from "../activities-repository/activities-repository.module";

/**
 * Module responsible for registering queue across all services.
 * All modules that register queue should do so through this.
 */
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
