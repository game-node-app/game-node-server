import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { DeepPartial, Repository } from "typeorm";
import { YearRecap } from "./entity/year-recap.entity";
import { InjectRepository } from "@nestjs/typeorm";
import dayjs from "dayjs";
import { PlaytimeHistoryService } from "../playtime/playtime-history.service";
import { Transactional } from "typeorm-transactional";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { CollectionsService } from "../collections/collections.service";
import { ProfileMetricsDistributionService } from "../profile/profile-metrics/profile-metrics-distribution.service";
import { ProfileMetricsTypeDistributionBy } from "../profile/profile-metrics/dto/profile-metrics-type-distribution.dto";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { PlaytimeInPeriod } from "../playtime/playtime.types";
import { YearRecapPlayedGame } from "./entity/year-recap-played-game.entity";
import { ReviewsService } from "../reviews/reviews.service";
import { FollowService } from "../follow/follow.service";

interface RecapPeriod {
    startDate: dayjs.Dayjs;
    endDate: dayjs.Dayjs;
}

@Injectable()
export class RecapCreateService {
    constructor(
        @InjectRepository(YearRecap)
        private readonly recapRepository: Repository<YearRecap>,
        private readonly collectionsService: CollectionsService,
        private readonly collectionEntryService: CollectionsEntriesService,
        private readonly profileMetricsDistributionService: ProfileMetricsDistributionService,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
        private readonly reviewsService: ReviewsService,
        private readonly followService: FollowService,
    ) {
        this.createRecap("d11a23a8-113c-4373-9276-821fb832aa57");
    }

    private getTargetPeriod(): RecapPeriod {
        const now = dayjs();
        if (now.month() > 0 && now.month() < 10) {
            throw new HttpException(
                "Recap is only available between November and January.",
                HttpStatus.BAD_REQUEST,
            );
        }

        if (now.month() === 0) {
            const lastYearDate = dayjs().set("year", now.year() - 1);
            return {
                startDate: lastYearDate.startOf("year"),
                endDate: lastYearDate.endOf("year"),
            };
        }

        return {
            startDate: dayjs().startOf("year"),
            endDate: dayjs().endOf("year"),
        };
    }

    private async getCollectionsInPeriod(userId: string, period: RecapPeriod) {
        const collections =
            await this.collectionsService.findAllByUserIdWithPermissions(
                userId,
                userId,
            );

        const createdInPeriod = collections.filter((collection) => {
            const createdAt = dayjs(collection.createdAt);
            return (
                createdAt.isAfter(period.startDate) &&
                createdAt.isBefore(period.endDate)
            );
        });

        return {
            totalCreatedInPeriod: createdInPeriod.length,
        };
    }

    private async getCollectionEntriesInPeriod(
        userId: string,
        period: RecapPeriod,
    ) {
        const entries =
            await this.collectionEntryService.findAllByUserIdInPeriod(userId, {
                startDate: period.startDate.toDate(),
                endDate: period.endDate.toDate(),
            });

        const createdInPeriod = entries.filter((entry) => {
            const createdAt = dayjs(entry.createdAt);
            return (
                createdAt.isAfter(period.startDate) &&
                createdAt.isBefore(period.endDate)
            );
        });

        const playedInPeriod = entries.filter((entry) => {
            const targetDate =
                entry.startedAt || entry.finishedAt || entry.droppedAt;
            if (!targetDate) {
                return false;
            }

            const playedAt = dayjs(targetDate);
            return (
                playedAt.isAfter(period.startDate) &&
                playedAt.isBefore(period.endDate)
            );
        });

        return {
            totalCreatedInPeriod: createdInPeriod.length,
            playedInPeriod,
        };
    }

    private async getPlayedGamesInPeriod(
        userId: string,
        period: RecapPeriod,
        entriesPlayed: CollectionEntry[],
    ) {
        const totalPerGame: Omit<PlaytimeInPeriod, "source">[] =
            await this.playtimeHistoryService.getTotalPlaytimeForPeriod({
                userId,
                startDate: period.startDate.toDate(),
                endDate: period.endDate.toDate(),
            });

        const totalPlaytime = totalPerGame.reduce(
            (acc, cur) => acc + cur.totalPlaytimeInPeriodSeconds,
            0,
        );

        const playedGamesParsed: Partial<YearRecapPlayedGame>[] = totalPerGame
            .filter((playtime) => playtime.totalPlaytimeInPeriodSeconds > 0)
            .toSorted((a, b) => {
                return (
                    b.totalPlaytimeInPeriodSeconds -
                    a.totalPlaytimeInPeriodSeconds
                );
            })
            .map((playtime): Partial<YearRecapPlayedGame> => {
                const percentageInPeriod =
                    playtime.totalPlaytimeInPeriodSeconds / totalPlaytime;
                return {
                    ...playtime,
                    percentOfTotalPlaytime: parseFloat(
                        percentageInPeriod.toFixed(4),
                    ),
                    percentOfTotalPlaytimeFormatted: (
                        percentageInPeriod * 100
                    ).toFixed(2),
                };
            });

        // Collection entry fallback for users that don't have playtime data
        for (const collectionEntry of entriesPlayed) {
            const exists = playedGamesParsed.find(
                (game) => game.gameId === collectionEntry.gameId,
            );

            if (!exists && collectionEntry.ownedPlatforms.length > 0) {
                playedGamesParsed.push({
                    gameId: collectionEntry.gameId,
                    totalPlaytimeSeconds: 0,
                    percentOfTotalPlaytime: 0,
                    percentOfTotalPlaytimeFormatted: "0.00",
                    platformId: collectionEntry.ownedPlatforms.at(0)!.id,
                });
            }
        }

        return {
            totalPlaytimeInPeriodSeconds: totalPlaytime,
            playedGames: playedGamesParsed,
        };
    }

    private async getLibraryDistributionInPeriod(
        userId: string,
        period: RecapPeriod,
    ): Promise<
        Pick<
            DeepPartial<YearRecap>,
            "modes" | "genres" | "platforms" | "themes"
        >
    > {
        const year = period.startDate.year();

        const [byMode, byGenre, byPlatform, byTheme] = await Promise.all([
            this.profileMetricsDistributionService.getTypeDistribution(userId, {
                by: ProfileMetricsTypeDistributionBy.MODE,
                year: year,
            }),
            this.profileMetricsDistributionService.getTypeDistribution(userId, {
                by: ProfileMetricsTypeDistributionBy.GENRE,
                year: year,
            }),
            this.profileMetricsDistributionService.getTypeDistribution(userId, {
                by: ProfileMetricsTypeDistributionBy.PLATFORM,
                year: year,
            }),
            this.profileMetricsDistributionService.getTypeDistribution(userId, {
                by: ProfileMetricsTypeDistributionBy.THEME,
                year: year,
            }),
        ]);

        return {
            modes: byMode.distribution.map((item) => ({
                modeId: item.criteriaId,
                totalGames: item.count,
            })),
            genres: byGenre.distribution.map((item) => ({
                genreId: item.criteriaId,
                totalGames: item.count,
            })),
            platforms: byPlatform.distribution.map((item) => ({
                platformId: item.criteriaId,
                totalGames: item.count,
            })),
            themes: byTheme.distribution.map((item) => ({
                themeId: item.criteriaId,
                totalGames: item.count,
            })),
        };
    }

    private async getReviewsInPeriod(userId: string, period: RecapPeriod) {
        const [reviews] = await this.reviewsService.findAllByUserId(userId, {
            limit: 1_000_000,
        });

        const totalReviews = reviews.filter((review) => {
            const createdAt = dayjs(review.createdAt);
            return (
                createdAt.isAfter(period.startDate) &&
                createdAt.isBefore(period.endDate)
            );
        });

        return {
            totalCreatedReviews: totalReviews.length,
        };
    }

    @Transactional()
    async createRecap(userId: string) {
        const period = this.getTargetPeriod();
        const collectionsInPeriod = await this.getCollectionsInPeriod(
            userId,
            period,
        );
        const entriesInPeriod = await this.getCollectionEntriesInPeriod(
            userId,
            period,
        );

        const playedGamesInPeriod = await this.getPlayedGamesInPeriod(
            userId,
            period,
            entriesInPeriod.playedInPeriod,
        );

        const distributionInPeriod = await this.getLibraryDistributionInPeriod(
            userId,
            period,
        );

        const reviewsInPeriod = await this.getReviewsInPeriod(userId, period);

        const followersGained = await this.followService.countFollowers(
            userId,
            {
                startDate: period.startDate.toDate(),
                endDate: period.endDate.toDate(),
            },
        );

        const entity = this.recapRepository.create({
            profileUserId: userId,
            year: period.startDate.year(),
            // TODO
            totalReviewsCreated: reviewsInPeriod.totalCreatedReviews,
            totalFollowersGained: followersGained,
            totalLikesReceived: 0,
            totalCollectionsCreated: collectionsInPeriod.totalCreatedInPeriod,
            totalAddedGames: entriesInPeriod.totalCreatedInPeriod,
            totalPlaytimeSeconds:
                playedGamesInPeriod.totalPlaytimeInPeriodSeconds,
            totalPlayedGames: playedGamesInPeriod.playedGames.length,
            playedGames: playedGamesInPeriod.playedGames,
            // genres: distributionInPeriod.genres,
            // modes: distributionInPeriod.modes,
            platforms: distributionInPeriod.platforms,
            // themes: distributionInPeriod.themes,
        });

        await this.recapRepository.save(entity);
    }
}
