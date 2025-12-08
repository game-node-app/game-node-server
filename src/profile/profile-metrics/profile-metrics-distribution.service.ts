import { Injectable } from "@nestjs/common";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import {
    ProfileMetricsYearDistributionBy,
    ProfileMetricsYearDistributionItem,
    ProfileMetricsYearDistributionRequestDto,
    ProfileMetricsYearDistributionResponseDto,
} from "./dto/profile-metrics-year-distribution.dto";
import {
    ProfileMetricsTypeDistributionBy,
    ProfileMetricsTypeDistributionItem,
    ProfileMetricsTypeDistributionRequestDto,
    ProfileMetricsTypeDistributionResponseDto,
} from "./dto/profile-metrics-type-distribution.dto";
import { getGameCategoryName } from "../../game/game-repository/game-repository.utils";
import { ReviewsService } from "../../reviews/reviews.service";
import { PlaytimeService } from "../../playtime/playtime.service";
import dayjs from "dayjs";
import { CollectionEntryStatus } from "../../collections/collections-entries/collections-entries.constants";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";

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
        /**
         * A map connecting a year (number) to a distribution item object.
         */
        const distributionMap = new Map<
            number,
            ProfileMetricsYearDistributionItem
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

        const [reviewedGames] =
            await this.reviewsService.findAllByUserIdAndGameIds(
                userId,
                gameIds,
            );

        const isReviewed = (gameId: number) =>
            reviewedGames.some((review) => review.gameId === gameId);

        const incrementDistribution = (
            year: number,
            count: number,
            isReviewed: boolean,
        ) => {
            const existing = distributionMap.get(year);
            if (!existing) {
                distributionMap.set(year, {
                    year,
                    count,
                    reviewedCount: isReviewed ? 1 : 0,
                });
                return;
            }
            distributionMap.set(year, {
                year,
                count: existing.count + count,
                reviewedCount: isReviewed
                    ? (existing.reviewedCount ?? 0) + 1
                    : existing.reviewedCount,
            });
        };

        switch (dto.by) {
            case ProfileMetricsYearDistributionBy.FINISH_YEAR: {
                const finishedGames = collectionEntries.filter(
                    (entry) => entry.finishedAt != undefined,
                );

                for (const entry of finishedGames) {
                    const finishYear = dayjs(entry.finishedAt).year();

                    incrementDistribution(
                        finishYear,
                        1,
                        isReviewed(entry.gameId),
                    );
                }
                break;
            }

            case ProfileMetricsYearDistributionBy.RELEASE_YEAR: {
                const gamesIds = collectionEntries.map((entry) => entry.gameId);
                const games = await this.gameRepositoryService.findAllByIds({
                    gameIds: gamesIds,
                });

                for (const game of games) {
                    if (game.firstReleaseDate == undefined) {
                        continue;
                    }

                    const releaseYear = dayjs(game.firstReleaseDate).year();
                    incrementDistribution(releaseYear, 1, isReviewed(game.id));
                }

                break;
            }

            case ProfileMetricsYearDistributionBy.PLAYTIME: {
                const [playtimes] = await this.playtimeService.findAllByUserId(
                    userId,
                    {
                        limit: 9999999,
                    },
                );

                for (const playtime of playtimes) {
                    const registeredYear = dayjs(playtime.createdAt).year();

                    incrementDistribution(
                        registeredYear,
                        playtime.totalPlaytimeSeconds,
                        false,
                    );
                }
            }
        }

        const orderedDistributionItems = Array.from(
            distributionMap.values(),
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

        const collectionEntries: CollectionEntry[] = [];
        if (dto.year) {
            const startDate = dayjs().year(dto.year).startOf("year").toDate();
            const endDate = dayjs().year(dto.year).endOf("year").toDate();
            const entries =
                await this.collectionsEntriesService.findAllByUserIdInPeriod(
                    userId,
                    { startDate, endDate },
                );
            collectionEntries.push(...entries);
        } else {
            const [entries] =
                await this.collectionsEntriesService.findAllByUserIdWithPermissions(
                    userId,
                    userId,
                    {
                        limit: 9999999,
                        offset: 0,
                    },
                );

            collectionEntries.push(...entries);
        }

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
            case ProfileMetricsTypeDistributionBy.STATUS: {
                for (const entry of collectionEntries) {
                    const statusValues = Object.values(CollectionEntryStatus);
                    const statusIndex = statusValues.indexOf(entry.status);
                    const statusText =
                        entry.status.charAt(0).toUpperCase() +
                        entry.status.slice(1);
                    incrementDistribution(statusIndex, statusText, false);
                }
            }
        }

        return {
            distribution: Array.from(distributionMap.values()),
        };
    }
}
