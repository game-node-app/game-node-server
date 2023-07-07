import { Module } from "@nestjs/common";
import { StatisticsService } from "./statistics.service";
import { StatisticsController } from "./statistics.controller";
import { BullModule } from "@nestjs/bull";
import { StatisticsQueueService } from "./statistics.queue.service";

@Module({
    imports: [BullModule.registerQueue({ name: "statistics" })],
    controllers: [StatisticsController],
    providers: [StatisticsService, StatisticsQueueService],
})
export class StatisticsModule {}
