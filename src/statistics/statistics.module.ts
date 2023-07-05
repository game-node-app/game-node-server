import { Module } from "@nestjs/common";
import { StatisticsService } from "./statistics.service";
import { StatisticsController } from "./statistics.controller";
import { BullModule } from "@nestjs/bull";

@Module({
    imports: [BullModule.registerQueue({ name: "statistics" })],
    controllers: [StatisticsController],
    providers: [StatisticsService],
})
export class StatisticsModule {}
