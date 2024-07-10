import { Injectable } from "@nestjs/common";
import { CollectionsService } from "../../collections/collections.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { ProfileMetricsOverviewDto } from "./dto/profile-metrics-overview.dto";
import { HltbSyncService } from "../../sync/hltb/hltb-sync.service";
import {
    ProfileMetricsDistribution,
    ProfileMetricsDistributionRequestDto,
    ProfileMetricsDistributionYearToData,
} from "./dto/profile-metrics-distribution.dto";
import { GamePlaytime } from "../../sync/hltb/entity/game-playtime.entity";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { Game } from "../../game/game-repository/entities/game.entity";

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

        return playtimes.reduce((acc, curr) => {
            acc.set(curr.gameId, curr);
            return acc;
        }, new Map<number, GamePlaytime>());
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

    async getDistribution(
        userId: string,
        dto: ProfileMetricsDistributionRequestDto,
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

        const distribution: ProfileMetricsDistributionYearToData = {};

        switch (dto.by) {
            case ProfileMetricsDistribution.FINISH_YEAR: {
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

                    if (!Object.hasOwn(distribution, finishYear)) {
                        const estimatedPlaytime = playtime?.timeMain || 0;

                        distribution[finishYear] = {
                            count: 1,
                            totalEstimatedPlaytime: estimatedPlaytime,
                        };

                        continue;
                    }

                    const count = distribution[finishYear]["count"] + 1;
                    let totalPlaytime =
                        distribution[finishYear]["totalEstimatedPlaytime"] || 0;
                    if (playtime && playtime.timeMain) {
                        totalPlaytime += playtime.timeMain;
                    }

                    distribution[finishYear] = {
                        count,
                        totalEstimatedPlaytime: totalPlaytime,
                    };
                }
                break;
            }
            case ProfileMetricsDistribution.RELEASE_YEAR: {
                const gamesIds = collectionEntries.map((entry) => entry.gameId);
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds: gamesIds,
                });

                const playtimesMap = await this.getPlaytimeForGames(gamesIds);

                const gamesMap = games.reduce((acc, curr) => {
                    acc.set(curr.id, curr);
                    return acc;
                }, new Map<number, Game>());

                for (const entry of collectionEntries) {
                    const relatedGame = gamesMap.get(entry.gameId);
                    const playtime = playtimesMap.get(entry.gameId);
                    // Technically impossible
                    if (!relatedGame) continue;
                    const releaseDate = relatedGame.firstReleaseDate;
                    const releaseYear = releaseDate.getFullYear().toString();

                    if (!Object.hasOwn(distribution, releaseYear)) {
                        const estimatedPlaytime = playtime?.timeMain || 0;

                        distribution[releaseYear] = {
                            count: 1,
                            totalEstimatedPlaytime: estimatedPlaytime,
                        };

                        continue;
                    }

                    const count = distribution[releaseYear]["count"] + 1;
                    let totalPlaytime =
                        distribution[releaseYear]["totalEstimatedPlaytime"] ||
                        0;
                    if (playtime && playtime.timeMain) {
                        totalPlaytime += playtime.timeMain;
                    }

                    distribution[releaseYear] = {
                        count,
                        totalEstimatedPlaytime: totalPlaytime,
                    };
                }

                break;
            }
        }
    }
}
