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
        const [collectionEntries, totalCollectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                undefined,
                userId,
                {
                    limit: 9999999,
                    offset: 0,
                },
            );

        const [userPlaytimes] = await this.playtimeService.findAllByUserId(
            userId,
            {
                offset: 0,
                limit: 9999999,
            },
        );

        const finishedCollectionEntries = collectionEntries.filter((entry) => {
            return entry.finishedAt != undefined;
        });

        const totalEstimatedPlaytime = userPlaytimes.reduce((acc, curr) => {
            acc += curr.totalPlaytimeSeconds;

            return acc;
        }, 0);

        return {
            totalCollections: collections.length,
            totalFinishedGames: finishedCollectionEntries.length,
            totalGames: totalCollectionEntries,
            totalEstimatedPlaytime: totalEstimatedPlaytime,
        };
    }
}
