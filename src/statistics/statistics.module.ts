import { Module } from "@nestjs/common";
import { StatisticsController } from "./statistics.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { StatisticsService } from "./statistics.service";
import { StatisticsTarget } from "./entity/statistics-target.entity";
import { EngagementState } from "./entity/engagement-state.entity";
import { StatisticsEvent } from "./entity/statistics-event.entity";
import { MetricTotal } from "./entity/metric-total.entity";
import { MetricHour } from "./entity/metric-hour.entity";
import { RankingScore } from "./entity/ranking-score.entity";
import { StatisticsProjectionModule } from "./statistics-projection.module";
import { StatisticsRankingService } from "./statistics-ranking.service";
import { StatisticsRankingScheduler } from "./statistics-ranking.scheduler";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            StatisticsTarget,
            EngagementState,
            StatisticsEvent,
            MetricTotal,
            MetricHour,
            RankingScore,
        ]),
        StatisticsProjectionModule,
    ],
    providers: [
        StatisticsService,
        StatisticsRankingService,
        StatisticsRankingScheduler,
    ],
    controllers: [StatisticsController],
    exports: [StatisticsService],
})
export class StatisticsModule {}
