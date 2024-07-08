import { Injectable, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../../auth/auth.guard";
import { CollectionsService } from "../../collections/collections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileStatisticsOverviewDto } from "./dto/profile-statistics-overview.dto";
import { HltbSyncService } from "../../sync/hltb/hltb-sync.service";
import {
    ProfileStatisticsDistribution,
    ProfileStatisticsDistributionRequestDto,
} from "./dto/profile-statistics-distribution-request.dto";

@Injectable()
export class ProfileStatisticsService {
    constructor(
        private readonly collectionsService: CollectionsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly htlbService: HltbSyncService,
    ) {}

    /**
     * Returns an estimate total playtime for games based on the HLTB 'main' profile.
     * @param gameIds
     * @private
     */
    private async getTotalPlaytimeForGames(gameIds: number[]) {
        const playtimes = await this.htlbService.findAllByGameIds(gameIds);
        return playtimes.reduce((prev, curr) => {
            if (!curr.timeMain) return prev;

            return prev + curr.timeMain;
        }, 0);
    }

    async getStatsOverview(
        userId: string,
    ): Promise<ProfileStatisticsOverviewDto> {
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

        const estimatedPlaytime =
            await this.getTotalPlaytimeForGames(finishedGamesIds);

        return {
            totalCollections: collections.length,
            totalFinishedGames: finishedCollectionEntries.length,
            totalGames: collectionEntries.length,
            totalEstimatedPlaytime: estimatedPlaytime,
        };
    }

    async getDistribution(
        userId: string,
        dto: ProfileStatisticsDistributionRequestDto,
    ) {
        const [collectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                undefined,
                userId,
                {
                    limit: undefined,
                    offset: 0,
                },
            );

        switch (dto.by) {
            case ProfileStatisticsDistribution.FINISH_YEAR: {
                const finishedGames = collectionEntries.filter(
                    (entry) => entry.finishedAt != undefined,
                );
                break;
            }
            case ProfileStatisticsDistribution.RELEASE_YEAR:
                break;
        }
    }
}
