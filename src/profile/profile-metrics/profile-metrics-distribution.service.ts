import { Injectable } from "@nestjs/common";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import {
    ProfileMetricsYearDistributionBy,
    ProfileMetricsYearDistributionItem,
    ProfileMetricsYearDistributionRequestDto,
    ProfileMetricsYearDistributionResponseDto,
} from "./dto/profile-metrics-year-distribution.dto";
import { toMap } from "../../utils/toMap";
import {
    ProfileMetricsTypeDistributionBy,
    ProfileMetricsTypeDistributionItem,
    ProfileMetricsTypeDistributionRequestDto,
    ProfileMetricsTypeDistributionResponseDto,
} from "./dto/profile-metrics-type-distribution.dto";
import { getGameCategoryName } from "../../game/game-repository/game-repository.utils";
import { ReviewsService } from "../../reviews/reviews.service";
import { PlaytimeService } from "../../playtime/playtime.service";

@Injectable()
export class ProfileMetricsDistributionService {
    constructor(
        private readonly collectionsEntriesService: CollectionsEntriesService,
        private readonly playtimeService: PlaytimeService,
        private readonly gameRepositoryService: GameRepositoryService,
        private readonly reviewsService: ReviewsService,
    ) {}

    async getYearDistribution(
        userId: string,
        dto: ProfileMetricsYearDistributionRequestDto,
    ): Promise<ProfileMetricsYearDistributionResponseDto> {
        const [collectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                userId,
                userId,
                {
                    limit: 9999999,
                    offset: 0,
                },
            );

        const gameIds = collectionEntries.map((entry) => entry.gameId);

        const [reviewedGames] =
            await this.reviewsService.findAllByUserIdAndGameIds(
                userId,
                gameIds,
            );

        /**
         * A map connecting a year (number) to a distribution item object.
         */
        const distributionByYearData = new Map<
            number,
            ProfileMetricsYearDistributionItem
        >();

        switch (dto.by) {
            case ProfileMetricsYearDistributionBy.FINISH_YEAR: {
                const finishedGames = collectionEntries.filter(
                    (entry) => entry.finishedAt != undefined,
                );

                for (const entry of finishedGames) {
                    const isReviewed = reviewedGames.some(
                        (review) => review.gameId === entry.gameId,
                    );
                    const finishDate: Date = entry.finishedAt!;
                    const finishYear = finishDate.getFullYear();

                    const previousData = distributionByYearData.get(finishYear);

                    if (!previousData) {
                        distributionByYearData.set(finishYear, {
                            year: finishYear,
                            count: 1,
                            reviewedCount: isReviewed ? 1 : 0,
                        });

                        continue;
                    }

                    const updatedData: ProfileMetricsYearDistributionItem = {
                        ...previousData,
                        count: previousData.count + 1,
                        reviewedCount: isReviewed
                            ? previousData.reviewedCount! + 1
                            : previousData.reviewedCount,
                    };

                    distributionByYearData.set(finishYear, updatedData);
                }
                break;
            }

            case ProfileMetricsYearDistributionBy.RELEASE_YEAR: {
                const gamesIds = collectionEntries.map((entry) => entry.gameId);
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds: gamesIds,
                });

                const gamesMap = toMap(games, "id");

                for (const entry of collectionEntries) {
                    const relatedGame = gamesMap.get(entry.gameId);
                    // Technically impossible
                    if (!relatedGame) continue;
                    const isReviewed = reviewedGames.some(
                        (review) => review.gameId === entry.gameId,
                    );

                    const releaseDate = relatedGame.firstReleaseDate;
                    if (!releaseDate) continue;
                    const releaseYear = releaseDate.getFullYear();

                    const previousData =
                        distributionByYearData.get(releaseYear);

                    if (!previousData) {
                        distributionByYearData.set(releaseYear, {
                            year: releaseYear,
                            count: 1,
                            reviewedCount: isReviewed ? 1 : 0,
                        });

                        continue;
                    }

                    distributionByYearData.set(releaseYear, {
                        ...previousData,
                        count: previousData.count + 1,
                        reviewedCount: isReviewed
                            ? previousData.reviewedCount! + 1
                            : previousData.reviewedCount,
                    });
                }

                break;
            }

            case ProfileMetricsYearDistributionBy.PLAYTIME: {
                const playtimeMap = await this.playtimeService.getPlaytimesMap(
                    userId,
                    gameIds,
                );

                for (const collectionEntry of collectionEntries) {
                    const playtime = playtimeMap.get(collectionEntry.gameId);

                    if (!playtime) continue;

                    const addedYear = collectionEntry.createdAt.getFullYear();

                    const previousData = distributionByYearData.get(addedYear);

                    if (!previousData) {
                        distributionByYearData.set(addedYear, {
                            year: addedYear,
                            count: playtime.totalPlaytimeSeconds,
                        });
                        continue;
                    }

                    const totalPlaytime =
                        previousData.count + playtime.totalPlaytimeSeconds;

                    distributionByYearData.set(addedYear, {
                        ...previousData,
                        count: totalPlaytime,
                    });
                }

                break;
            }
        }

        const orderedDistributionItems = Array.from(
            distributionByYearData.values(),
        ).toSorted((a, b) => {
            return a.year - b.year;
        });

        return {
            distribution: orderedDistributionItems,
        };
    }

    async getTypeDistribution(
        userId: string,
        dto: ProfileMetricsTypeDistributionRequestDto,
    ): Promise<ProfileMetricsTypeDistributionResponseDto> {
        const [collectionEntries] =
            await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                userId,
                userId,
                {
                    limit: 9999999,
                    offset: 0,
                },
            );

        const gameIds = collectionEntries.map((entry) => entry.gameId);

        /**
         * Map connecting a criteriaId (e.g. game genre id) to an item object.
         */
        const distributionCriteriaIdToData = new Map<
            number,
            ProfileMetricsTypeDistributionItem
        >();

        switch (dto.by) {
            case ProfileMetricsTypeDistributionBy.CATEGORY: {
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds,
                });

                for (const game of games) {
                    const categoryId = game.category.valueOf();
                    const categoryName = getGameCategoryName(categoryId);
                    const isFinished = collectionEntries.some((entry) => {
                        return (
                            entry.gameId === game.id &&
                            entry.finishedAt != undefined
                        );
                    });

                    const previousData =
                        distributionCriteriaIdToData.get(categoryId);
                    if (!previousData) {
                        distributionCriteriaIdToData.set(categoryId, {
                            criteriaId: categoryId,
                            criteriaName: categoryName!,
                            count: 1,
                            finishedCount: isFinished ? 1 : 0,
                        });
                        continue;
                    }

                    const totalFinishedCount = isFinished
                        ? previousData.finishedCount + 1
                        : previousData.finishedCount;

                    distributionCriteriaIdToData.set(categoryId, {
                        ...previousData,
                        count: previousData.count + 1,
                        finishedCount: totalFinishedCount,
                    });
                }

                break;
            }

            case ProfileMetricsTypeDistributionBy.GENRE: {
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds,
                    relations: {
                        genres: true,
                    },
                });

                for (const game of games) {
                    const isFinished = collectionEntries.some((entry) => {
                        return (
                            entry.gameId === game.id &&
                            entry.finishedAt != undefined
                        );
                    });

                    if (!game.genres) {
                        continue;
                    }

                    for (const genre of game.genres) {
                        const genreId = genre.id;
                        const genreName = genre.name;
                        if (!genreName) continue;

                        const previousData =
                            distributionCriteriaIdToData.get(genreId);

                        if (!previousData) {
                            distributionCriteriaIdToData.set(genreId, {
                                criteriaId: genreId,
                                criteriaName: genreName,
                                count: 1,
                                finishedCount: isFinished ? 1 : 0,
                            });
                            continue;
                        }

                        const totalFinishedCount = isFinished
                            ? previousData.finishedCount + 1
                            : previousData.finishedCount;

                        distributionCriteriaIdToData.set(genreId, {
                            ...previousData,
                            count: previousData.count + 1,
                            finishedCount: totalFinishedCount,
                        });
                    }
                }

                break;
            }

            case ProfileMetricsTypeDistributionBy.MODE: {
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds,
                    relations: {
                        gameModes: true,
                    },
                });

                for (const game of games) {
                    const isFinished = collectionEntries.some((entry) => {
                        return (
                            entry.gameId === game.id &&
                            entry.finishedAt != undefined
                        );
                    });

                    for (const mode of game.gameModes!) {
                        if (mode.name == undefined) continue;

                        const previousData = distributionCriteriaIdToData.get(
                            mode.id,
                        );
                        if (!previousData) {
                            distributionCriteriaIdToData.set(mode.id, {
                                criteriaId: mode.id,
                                criteriaName: mode.name,
                                count: 1,
                                finishedCount: isFinished ? 1 : 0,
                            });
                            continue;
                        }

                        const totalFinishedCount = isFinished
                            ? previousData.finishedCount + 1
                            : previousData.finishedCount;

                        distributionCriteriaIdToData.set(mode.id, {
                            ...previousData,
                            count: previousData.count + 1,
                            finishedCount: totalFinishedCount,
                        });
                    }
                }
                break;
            }

            case ProfileMetricsTypeDistributionBy.THEME: {
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds,
                    relations: {
                        themes: true,
                    },
                });

                for (const game of games) {
                    const isFinished = collectionEntries.some((entry) => {
                        return (
                            entry.gameId === game.id &&
                            entry.finishedAt != undefined
                        );
                    });

                    for (const theme of game.themes!) {
                        if (theme.name == undefined) continue;

                        const previousData = distributionCriteriaIdToData.get(
                            theme.id,
                        );
                        if (!previousData) {
                            distributionCriteriaIdToData.set(theme.id, {
                                criteriaId: theme.id,
                                criteriaName: theme.name,
                                count: 1,
                                finishedCount: isFinished ? 1 : 0,
                            });
                            continue;
                        }

                        const totalFinishedCount = isFinished
                            ? previousData.finishedCount + 1
                            : previousData.finishedCount;

                        distributionCriteriaIdToData.set(theme.id, {
                            ...previousData,
                            count: previousData.count + 1,
                            finishedCount: totalFinishedCount,
                        });
                    }
                }
                break;
            }

            case ProfileMetricsTypeDistributionBy.PLATFORM: {
                for (const collectionEntry of collectionEntries) {
                    const isFinished = collectionEntry.finishedAt != undefined;

                    for (const platform of collectionEntry.ownedPlatforms) {
                        const platformId = platform.id;
                        const platformName = platform.name;
                        const previousData =
                            distributionCriteriaIdToData.get(platformId);

                        if (!previousData) {
                            distributionCriteriaIdToData.set(platformId, {
                                criteriaId: platformId,
                                criteriaName: platformName,
                                count: 1,
                                finishedCount: isFinished ? 1 : 0,
                            });
                            continue;
                        }

                        distributionCriteriaIdToData.set(platformId, {
                            ...previousData,
                            count: previousData.count + 1,
                            finishedCount: isFinished
                                ? previousData.finishedCount + 1
                                : previousData.finishedCount,
                        });
                    }
                }
                break;
            }
        }

        return {
            distribution: Array.from(distributionCriteriaIdToData.values()),
        };
    }
}
