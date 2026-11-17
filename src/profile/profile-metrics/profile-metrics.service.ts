import { Injectable } from "@nestjs/common";
import { CollectionsService } from "../../collections/collections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileMetricsOverviewDto } from "./dto/profile-metrics-overview.dto";
import { PlaytimeService } from "../../playtime/playtime.service";
import { LibraryAccessService } from "../../libraries/library-access.service";

@Injectable()
export class ProfileMetricsService {
    constructor(
        private readonly collectionsService: CollectionsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly playtimeService: PlaytimeService,
        private readonly libraryAccessService: LibraryAccessService,
    ) {}

    async getStatsOverview(
        userId: string,
        viewerId?: string,
    ): Promise<ProfileMetricsOverviewDto> {
        const access = await this.libraryAccessService.resolve(
            viewerId,
            userId,
        );

        const [
            collections,
            [collectionEntries, totalCollectionEntries],
            totalEstimatedPlaytime,
        ] = await Promise.all([
            this.collectionsService.findAllByUserIdWithPermissions(
                viewerId,
                userId,
            ),
            this.collectionsEntriesService.findAllByUserIdWithPermissions(
                viewerId,
                userId,
                {
                    limit: 9999999,
                    offset: 0,
                },
            ),
            this.playtimeService.getTotalPlaytimeByUserId(
                userId,
                "totalPlaytimeSeconds",
                undefined,
                undefined,
                access,
            ),
        ]);

        const statsOverview: ProfileMetricsOverviewDto = {
            totalGames: totalCollectionEntries,
            totalCollections: collections.length,
            totalEstimatedPlaytime,
            totalFinishedGames: 0,
            totalFinishedGamesInYear: 0,
            totalPlayedGames: 0,
            totalPlayedGamesInYear: 0,
        };

        const currentYear = new Date().getFullYear();

        for (const entry of collectionEntries) {
            const startYear = entry.startedAt?.getFullYear();
            const finishYear = entry.finishedAt?.getFullYear();

            if (finishYear) {
                statsOverview.totalFinishedGames += 1;
                if (finishYear === currentYear) {
                    statsOverview.totalFinishedGamesInYear += 1;
                }
            }

            if (startYear) {
                statsOverview.totalPlayedGames += 1;
                if (startYear === currentYear) {
                    statsOverview.totalPlayedGamesInYear += 1;
                }
            }
        }

        return statsOverview;
    }
}
