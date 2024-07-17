import { Injectable } from "@nestjs/common";
import { CollectionsService } from "../../collections/collections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileMetricsOverviewDto } from "./dto/profile-metrics-overview.dto";
import { HltbSyncService } from "../../sync/hltb/hltb-sync.service";
import { GamePlaytime } from "../../sync/hltb/entity/game-playtime.entity";
import { toMap } from "../../utils/toMap";

@Injectable()
export class ProfileMetricsService {
    constructor(
        private readonly collectionsService: CollectionsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly hltbService: HltbSyncService,
    ) {}

    async getStatsOverview(userId: string): Promise<ProfileMetricsOverviewDto> {
        const collections =
            await this.collectionsService.findAllByUserIdWithPermissions(
                undefined,
                userId,
            );
        const [collectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                undefined,
                userId,
                {
                    limit: undefined,
                    offset: 0,
                },
            );

        const finishedCollectionEntries = collectionEntries.filter((entry) => {
            return entry.finishedAt != undefined;
        });

        const finishedGamesIds = finishedCollectionEntries.map(
            (entry) => entry.gameId,
        );

        const playtimeMap =
            await this.hltbService.getPlaytimesMap(finishedGamesIds);

        let totalEstimatedPlaytime = 0;
        for (const value of playtimeMap.values()) {
            if (!value.timeMain) continue;

            totalEstimatedPlaytime += value.timeMain;
        }

        return {
            totalCollections: collections.length,
            totalFinishedGames: finishedCollectionEntries.length,
            totalGames: collectionEntries.length,
            totalEstimatedPlaytime: totalEstimatedPlaytime,
        };
    }
}
