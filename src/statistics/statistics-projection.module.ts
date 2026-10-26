import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { StatisticsProjectionService } from "./statistics-projection.service";
import { StatisticsProjectionScheduler } from "./statistics-projection.scheduler";
import { StatisticsProjectionProcessor } from "./statistics-projection.processor";
import { STATISTICS_PROJECTION_QUEUE } from "./statistics-projection.constants";

@Module({
    imports: [
        BullModule.registerQueue({ name: STATISTICS_PROJECTION_QUEUE }),
    ],
    providers: [
        StatisticsProjectionService,
        StatisticsProjectionScheduler,
        StatisticsProjectionProcessor,
    ],
    exports: [StatisticsProjectionService],
})
export class StatisticsProjectionModule {}
