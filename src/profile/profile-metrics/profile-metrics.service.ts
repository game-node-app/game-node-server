import { Injectable } from "@nestjs/common";
import { CollectionsService } from "../../collections/collections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileMetricsOverviewDto } from "./dto/profile-metrics-overview.dto";
import { HltbSyncService } from "../../sync/hltb/hltb-sync.service";
import {
    ProfileMetricsYearDistributionBy,
    ProfileMetricsYearDistributionRequestDto,
    ProfileMetricsDistributionYearToData,
    ProfileMetricsYearDistributionItem,
    ProfileMetricsYearDistributionResponseDto,
} from "./dto/profile-metrics-year-distribution.dto";
import { GamePlaytime } from "../../sync/hltb/entity/game-playtime.entity";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { Game } from "../../game/game-repository/entities/game.entity";
import { toMap } from "../../utils/toMap";

@Injectable()
export class ProfileMetricsService {
    constructor(
        private readonly collectionsService: CollectionsService,
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly htlbService: HltbSyncService,
        private readonly gameRepositoryService: GameRepositoryService,
    ) {}

    /**
     * Returns an estimate total playtime for games based on the 'main' HLTB profile.
     * @param gameIds
     * @private
     * @returns Map<number, GamePlaytime> - A map between gameIds and gamePlaytimes
     */
    private async getPlaytimeForGames(
        gameIds: number[],
    ): Promise<Map<number, GamePlaytime>> {
        const playtimes = await this.htlbService.findAllByGameIds(gameIds);

        return toMap(playtimes, "gameId");
    }

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

        const playtimeMap = await this.getPlaytimeForGames(finishedGamesIds);

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

    async getYearDistribution(
        userId: string,
        dto: ProfileMetricsYearDistributionRequestDto,
    ): Promise<ProfileMetricsYearDistributionResponseDto> {
        const [collectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                undefined,
                userId,
                {
                    limit: undefined,
                    offset: 0,
                },
            );

        const distributionByYearData: ProfileMetricsDistributionYearToData = {};

        switch (dto.by) {
            case ProfileMetricsYearDistributionBy.FINISH_YEAR: {
                const finishedGames = collectionEntries.filter(
                    (entry) => entry.finishedAt != undefined,
                );
                const finishedGamesIds = finishedGames.map(
                    (entry) => entry.gameId,
                );

                const playtimeMap =
                    await this.getPlaytimeForGames(finishedGamesIds);

                for (const entry of finishedGames) {
                    const finishDate: Date = entry.finishedAt!;
                    const finishYear = finishDate.getFullYear().toString();
                    const playtime = playtimeMap.get(entry.gameId);

                    if (!Object.hasOwn(distributionByYearData, finishYear)) {
                        const estimatedPlaytime = playtime?.timeMain || 0;

                        distributionByYearData[finishYear] = {
                            count: 1,
                            totalEstimatedPlaytime: estimatedPlaytime,
                        };

                        continue;
                    }

                    const count =
                        distributionByYearData[finishYear]["count"] + 1;
                    let totalPlaytime =
                        distributionByYearData[finishYear][
                            "totalEstimatedPlaytime"
                        ] || 0;
                    if (playtime && playtime.timeMain) {
                        totalPlaytime += playtime.timeMain;
                    }

                    distributionByYearData[finishYear] = {
                        count,
                        totalEstimatedPlaytime: totalPlaytime,
                    };
                }
                break;
            }
            case ProfileMetricsYearDistributionBy.RELEASE_YEAR: {
                const gamesIds = collectionEntries.map((entry) => entry.gameId);
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds: gamesIds,
                });

                const playtimesMap = await this.getPlaytimeForGames(gamesIds);

                const gamesMap = toMap(games, "id");

                for (const entry of collectionEntries) {
                    const relatedGame = gamesMap.get(entry.gameId);
                    const playtime = playtimesMap.get(entry.gameId);
                    // Technically impossible
                    if (!relatedGame) continue;
                    const releaseDate = relatedGame.firstReleaseDate;
                    const releaseYear = releaseDate.getFullYear().toString();

                    if (!Object.hasOwn(distributionByYearData, releaseYear)) {
                        const estimatedPlaytime = playtime?.timeMain || 0;

                        distributionByYearData[releaseYear] = {
                            count: 1,
                            totalEstimatedPlaytime: estimatedPlaytime,
                        };

                        continue;
                    }

                    const count =
                        distributionByYearData[releaseYear]["count"] + 1;
                    let totalPlaytime =
                        distributionByYearData[releaseYear][
                            "totalEstimatedPlaytime"
                        ] || 0;
                    if (playtime && playtime.timeMain) {
                        totalPlaytime += playtime.timeMain;
                    }

                    distributionByYearData[releaseYear] = {
                        count,
                        totalEstimatedPlaytime: totalPlaytime,
                    };
                }

                break;
            }
        }

        const distributionItems = Object.entries(distributionByYearData).map(
            ([year, data]): ProfileMetricsYearDistributionItem => {
                return {
                    year: Number.parseInt(year),
                    count: data.count,
                    totalEstimatedPlaytime: data.totalEstimatedPlaytime,
                };
            },
        );

        const orderedDistributionItems = distributionItems.toSorted((a, b) => {
            return a.year - b.year;
        });

        return {
            distribution: orderedDistributionItems,
        };
    }
}
