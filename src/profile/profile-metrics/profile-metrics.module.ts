import { Module } from "@nestjs/common";
import { ProfileMetricsController } from "./profile-metrics.controller";
import { ProfileMetricsService } from "./profile-metrics.service";
import { CollectionsEntriesModule } from "../../collections/collections-entries/collections-entries.module";
import { CollectionsModule } from "../../collections/collections.module";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";
import { ProfileMetricsDistributionService } from "./profile-metrics-distribution.service";
import { ReviewsModule } from "../../reviews/reviews.module";
import { PlaytimeModule } from "../../playtime/playtime.module";
import { ProfileMetricsReportService } from "./profile-metrics-report.service";
import { ProfileMetricsSummaryService } from "./profile-metrics-summary.service";
import { LibrariesModule } from "../../libraries/libraries.module";

@Module({
    imports: [
        CollectionsModule,
        CollectionsEntriesModule,
        PlaytimeModule,
        GameRepositoryModule,
        ReviewsModule,
        LibrariesModule,
    ],
    controllers: [ProfileMetricsController],
    providers: [
        ProfileMetricsService,
        ProfileMetricsDistributionService,
        ProfileMetricsReportService,
        ProfileMetricsSummaryService,
    ],
    exports: [
        ProfileMetricsService,
        ProfileMetricsDistributionService,
        ProfileMetricsReportService,
        ProfileMetricsSummaryService,
    ],
})
export class ProfileMetricsModule {}
