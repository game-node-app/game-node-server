import { Module } from "@nestjs/common";
import { ProfileMetricsController } from "./profile-metrics.controller";
import { ProfileMetricsService } from "./profile-metrics.service";
import { CollectionsEntriesModule } from "../../collections/collections-entries/collections-entries.module";
import { CollectionsModule } from "../../collections/collections.module";
import { HltbSyncModule } from "../../sync/hltb/hltb-sync.module";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";
import { ProfileMetricsDistributionService } from "./profile-metrics-distribution.service";
import { ReviewsModule } from "../../reviews/reviews.module";

@Module({
    imports: [
        CollectionsModule,
        CollectionsEntriesModule,
        HltbSyncModule,
        GameRepositoryModule,
        ReviewsModule,
    ],
    controllers: [ProfileMetricsController],
    providers: [ProfileMetricsService, ProfileMetricsDistributionService],
})
export class ProfileMetricsModule {}
