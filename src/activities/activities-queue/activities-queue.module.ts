import { BullModule } from "@nestjs/bull";
import { Module } from "@nestjs/common";
import { ProfileModule } from "src/profile/profile.module";
import { ActivitiesQueueProcessor } from "./activities-queue-processor";
import { ActivitiesQueueService } from "./activities-queue.service";
import { ActivitiesRepositoryModule } from "../activities-repository/activities-repository.module";

/**
 * Module responsible for registering activities across all services.
 * All modules that register activities should do so through this.
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
