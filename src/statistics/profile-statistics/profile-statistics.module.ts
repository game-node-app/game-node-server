import { Module } from "@nestjs/common";
import { ProfileStatisticsController } from "./profile-statistics.controller";
import { ProfileStatisticsService } from "./profile-statistics.service";
import { CollectionsEntriesModule } from "../../collections/collections-entries/collections-entries.module";
import { CollectionsModule } from "../../collections/collections.module";
import { HltbSyncModule } from "../../sync/hltb/hltb-sync.module";

/**
 * Module responsible for providing profile's stats' data. <br>
 * This module is quite different from other modules with the same statistics prefix, because it doesn't
 * resolve around user likes and views.
 */
@Module({
    imports: [CollectionsModule, CollectionsEntriesModule, HltbSyncModule],
    controllers: [ProfileStatisticsController],
    providers: [ProfileStatisticsService],
})
export class ProfileStatisticsModule {}
