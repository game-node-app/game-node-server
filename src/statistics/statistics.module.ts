import { Module } from "@nestjs/common";
import { StatisticsController } from "./statistics.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StatisticsService } from "./statistics.service";
import { SuspensionModule } from "../suspension/suspension.module";
import { StatisticsTarget } from "./entity/statistics-target.entity";
import { EngagementState } from "./entity/engagement-state.entity";
import { StatisticsEvent } from "./entity/statistics-event.entity";
import { MetricTotal } from "./entity/metric-total.entity";
import { MetricHour } from "./entity/metric-hour.entity";
import { RankingScore } from "./entity/ranking-score.entity";
import { StatisticsMaintenance } from "./entity/statistics-maintenance.entity";
import { StatisticsProjectionModule } from "./statistics-projection.module";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { StatisticsRankingScheduler } from "./statistics-ranking.scheduler";
import { StatisticsMaintenanceService } from "./statistics-maintenance.service";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            StatisticsTarget,
            EngagementState,
            StatisticsEvent,
            MetricTotal,
            MetricHour,
            RankingScore,
            StatisticsMaintenance,
        ]),
        SuspensionModule,
        StatisticsProjectionModule,
    ],
    providers: [
        StatisticsService,
        StatisticsRankingService,
        StatisticsRankingScheduler,
        StatisticsMaintenanceService,
    ],
    controllers: [StatisticsController],
    exports: [StatisticsService, StatisticsMaintenanceService],
})
export class StatisticsModule {}
