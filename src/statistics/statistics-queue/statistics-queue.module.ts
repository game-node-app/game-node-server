import { Module } from "@nestjs/common";
import { StatisticsQueueService } from "./statistics-queue.service";
import { StatisticsQueueController } from "./statistics-queue.controller";
import { BullModule } from "@nestjs/bullmq";
import { STATISTICS_QUEUE_NAME } from "./statistics-queue.constants";
import { StatisticsModule } from "../statistics.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserLike } from "../entity/user-like.entity";
import { UserView } from "../entity/user-view.entity";
import { Statistics } from "../entity/statistics.entity";
import { StatisticsQueueProcessor } from "./statistics-queue.processor";

@Module({
    imports: [
        TypeOrmModule.forFeature([UserLike, UserView, Statistics]),
        BullModule.registerQueue({
            name: STATISTICS_QUEUE_NAME,
            defaultJobOptions: {
                removeOnComplete: true,
            },
        }),
        StatisticsModule,
    ],
    providers: [StatisticsQueueService, StatisticsQueueProcessor],
    controllers: [StatisticsQueueController],
})
export class StatisticsQueueModule {}
