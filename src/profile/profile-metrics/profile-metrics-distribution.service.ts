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
                    if (!releaseDate || !(releaseDate instanceof Date))
                        continue;
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
        /**
         * Map connecting a criteriaId (e.g. game genre id) to an item object.
         */
        const distributionMap = new Map<
            number,
            ProfileMetricsTypeDistributionItem
        >();

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

        const isGameFinished = (gameId: number) =>
            collectionEntries.some(
                (entry) => entry.gameId === gameId && !!entry.finishedAt,
            );

        const incrementDistribution = (
            id: number,
            name: string,
            isFinished: boolean,
        ) => {
            const existing = distributionMap.get(id);
            if (!existing) {
                distributionMap.set(id, {
                    criteriaId: id,
                    criteriaName: name,
                    count: 1,
                    finishedCount: isFinished ? 1 : 0,
                });
                return;
            }

            distributionMap.set(id, {
                ...existing,
                count: existing.count + 1,
                finishedCount: isFinished
                    ? existing.finishedCount + 1
                    : existing.finishedCount,
            });
        };

        switch (dto.by) {
            case ProfileMetricsTypeDistributionBy.CATEGORY: {
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds,
                });

                for (const game of games) {
                    const categoryId = game.category.valueOf();
                    const categoryName = getGameCategoryName(categoryId);
                    incrementDistribution(categoryId, categoryName!, false);
                }
                break;
            }

            case ProfileMetricsTypeDistributionBy.GENRE: {
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds,
                    relations: { genres: true },
                });

                for (const game of games) {
                    if (!game.genres) continue;
                    for (const genre of game.genres) {
                        if (!genre.name) continue;
                        incrementDistribution(
                            genre.id,
                            genre.name,
                            isGameFinished(game.id),
                        );
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
                    for (const mode of game.gameModes!) {
                        if (mode.name == undefined) continue;
                        const criteriaId = mode.id;
                        const criteriaName = mode.name;
                        incrementDistribution(
                            criteriaId,
                            criteriaName,
                            isGameFinished(game.id),
                        );
                    }
                }
                break;
            }

            case ProfileMetricsTypeDistributionBy.THEME: {
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds,
                    relations: { themes: true },
                });
                for (const game of games) {
                    for (const theme of game.themes ?? []) {
                        if (!theme.name) continue;
                        incrementDistribution(
                            theme.id,
                            theme.name,
                            isGameFinished(game.id),
                        );
                    }
                }
                break;
            }

            case ProfileMetricsTypeDistributionBy.PLATFORM: {
                for (const entry of collectionEntries) {
                    const isFinished = !!entry.finishedAt;
                    for (const platform of entry.ownedPlatforms) {
                        incrementDistribution(
                            platform.id,
                            platform.name,
                            isFinished,
                        );
                    }
                }
                break;
            }
        }

        return {
            distribution: Array.from(distributionMap.values()),
        };
    }
}
