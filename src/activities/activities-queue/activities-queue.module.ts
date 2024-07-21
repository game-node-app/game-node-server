import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ProfileModule } from "../../profile/profile.module";
import { ActivitiesQueueProcessor } from "./activities-queue-processor";
import { ActivitiesQueueService } from "./activities-queue.service";
import { ActivitiesRepositoryModule } from "../activities-repository/activities-repository.module";
import { BullBoardModule } from "@bull-board/nestjs";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";

@Module({
    imports: [
        ActivitiesRepositoryModule,
        BullModule.registerQueue({
            name: "activities",
        }),
        BullBoardModule.forFeature({
            name: "activities",
            adapter: BullMQAdapter,
        }),
        ProfileModule,
    ],
    providers: [ActivitiesQueueService, ActivitiesQueueProcessor],
    exports: [ActivitiesQueueService],
})
export class ActivitiesQueueModule {}
