import { BullModule } from "@nestjs/bullmq";
import { forwardRef, Module } from "@nestjs/common";
import { ProfileModule } from "../../profile/profile.module";
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
