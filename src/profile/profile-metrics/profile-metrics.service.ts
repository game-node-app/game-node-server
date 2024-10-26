import { Injectable } from "@nestjs/common";
import { CollectionsService } from "../../collections/collections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileMetricsOverviewDto } from "./dto/profile-metrics-overview.dto";
import { PlaytimeService } from "../../playtime/playtime.service";

@Injectable()
export class ProfileMetricsService {
    constructor(
        private readonly collectionsService: CollectionsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly playtimeService: PlaytimeService,
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
                    limit: 9999999,
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
            await this.playtimeService.getPlaytimesMap(finishedGamesIds);

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
