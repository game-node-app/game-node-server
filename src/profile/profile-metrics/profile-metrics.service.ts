import { Injectable } from "@nestjs/common";
import { CollectionsService } from "../../collections/collections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileMetricsOverviewDto } from "./dto/profile-metrics-overview.dto";
import { PlaytimeService } from "../../playtime/playtime.service";
import dayjs from "dayjs";

@Injectable()
export class ProfileMetricsService {
    constructor(
        private readonly collectionsService: CollectionsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly playtimeService: PlaytimeService,
    ) {}

    async getStatsOverview(userId: string): Promise<ProfileMetricsOverviewDto> {
        const [
            collections,
            [collectionEntries, totalCollectionEntries],
            totalPlaytimeSeconds,
        ] = await Promise.all([
            this.collectionsService.findAllByUserIdWithPermissions(
                userId,
                userId,
            ),
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                userId,
                userId,
                {
                    limit: 9999999,
                    offset: 0,
                },
            ),
            await this.playtimeService.getTotalPlaytimeByUserId(
                userId,
                "totalPlaytimeSeconds",
            ),
        ]);

        const statsOverview: ProfileMetricsOverviewDto = {
            totalGames: totalCollectionEntries,
            totalCollections: collections.length,
            totalEstimatedPlaytime: totalPlaytimeSeconds,
            totalFinishedGames: 0,
            totalFinishedGamesInYear: 0,
            totalPlayedGames: 0,
            totalPlayedGamesInYear: 0,
            totalPlannedGames: 0,
            totalPlannedGamesInYear: 0,
        };

        const currentYear = new Date().getFullYear();

        for (const entry of collectionEntries) {
            const startYear = entry.startedAt?.getFullYear();
            const finishYear = entry.finishedAt?.getFullYear();
            const plannedYear = entry.plannedAt?.getFullYear();

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

            if (plannedYear) {
                statsOverview.totalPlannedGames += 1;
                if (plannedYear === currentYear) {
                    statsOverview.totalPlannedGamesInYear += 1;
                }
            }
        }

        return statsOverview;
    }
}
