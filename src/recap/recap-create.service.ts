import { Injectable, Logger } from "@nestjs/common";
import { DataSource, DeepPartial, Repository } from "typeorm";
import {
    RecapCommunityHighlight,
    RecapCommunityHighlights,
    YearRecap,
} from "./entity/year-recap.entity";
import { InjectRepository } from "@nestjs/typeorm";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import {
    DailyPlaytime,
    PlaytimeHistoryService,
} from "../playtime/playtime-history.service";
import { Transactional } from "typeorm-transactional";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { CollectionsService } from "../collections/collections.service";
import { ProfileMetricsDistributionService } from "../profile/profile-metrics/profile-metrics-distribution.service";
import { ProfileMetricsTypeDistributionBy } from "../profile/profile-metrics/dto/profile-metrics-type-distribution.dto";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { PlaytimeInPeriod } from "../playtime/playtime.types";
import { YearRecapPlayedGame } from "./entity/year-recap-played-game.entity";
import { YearRecapGenre } from "./entity/year-recap-genre.entity";
import { YearRecapMode } from "./entity/year-recap-mode.entity";
import { YearRecapPlatform } from "./entity/year-recap-platform.entity";
import { YearRecapTheme } from "./entity/year-recap-theme.entity";
import { ReviewsService } from "../reviews/reviews.service";
import { FollowService } from "../follow/follow.service";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { SUPPORTED_EVENT_VERSION } from "../notifications/notifications.types";
import { recapCacheId } from "./recap.utils";

dayjs.extend(utc);

interface RecapPeriod {
    startDate: dayjs.Dayjs;
    endDate: dayjs.Dayjs;
}

interface RecapReview {
    gameId: number;
    rating: number;
    createdAt: Date;
}

interface CollectionEntryDetails {
    gameId: number;
    startedAt: Date | null;
    finishedAt: Date | null;
}

const COMMUNITY_REVIEW_THRESHOLD = 20;

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

@Injectable()
export class RecapCreateService {
    private readonly logger = new Logger(RecapCreateService.name);

    constructor(
        @InjectRepository(YearRecap)
        private readonly recapRepository: Repository<YearRecap>,
        private readonly collectionsService: CollectionsService,
        private readonly collectionEntryService: CollectionsEntriesService,
        private readonly profileMetricsDistributionService: ProfileMetricsDistributionService,
        private readonly playtimeHistoryService: PlaytimeHistoryService,
        private readonly reviewsService: ReviewsService,
        private readonly followService: FollowService,
        private readonly dataSource: DataSource,
    ) {}

    private getTargetPeriod(year: number): RecapPeriod {
        return {
            startDate: dayjs.utc(`${year}-01-01T00:00:00.000Z`),
            endDate: dayjs.utc(`${year}-12-31T23:59:59.999Z`),
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

    private async getLibraryCountsInPeriod(
        userId: string,
        period: RecapPeriod,
    ) {
        const [counts] = await this.dataSource.query(
            `SELECT
                (SELECT COUNT(*) FROM collection_entry
                 WHERE libraryUserId = ? AND finishedAt >= ? AND finishedAt <= ?) AS finished,
                (SELECT COUNT(*) FROM collection_entry
                 WHERE libraryUserId = ? AND droppedAt >= ? AND droppedAt <= ?) AS dropped`,
            [
                userId,
                period.startDate.toDate(),
                period.endDate.toDate(),
                userId,
                period.startDate.toDate(),
                period.endDate.toDate(),
            ],
        );

        return {
            finished: Number(counts.finished),
            dropped: Number(counts.dropped),
        };
    }

    private async getCollectionEntryDetails(
        userId: string,
        gameIds: number[],
    ): Promise<Map<number, CollectionEntryDetails>> {
        if (gameIds.length === 0) return new Map();

        const rows = await this.dataSource.query(
            `SELECT gameId, startedAt, finishedAt FROM collection_entry
             WHERE libraryUserId = ? AND gameId IN (${gameIds
                 .map(() => "?")
                 .join(",")})`,
            [userId, ...gameIds],
        );

        return new Map(
            rows.map((row: any) => [
                Number(row.gameId),
                {
                    gameId: Number(row.gameId),
                    startedAt: row.startedAt ? new Date(row.startedAt) : null,
                    finishedAt: row.finishedAt
                        ? new Date(row.finishedAt)
                        : null,
                },
            ]),
        );
    }

    private earliestPlayedDayByGame(rows: DailyPlaytime[]) {
        const earliest = new Map<number, string>();

        for (const row of rows) {
            if (row.seconds <= 0) continue;
            const current = earliest.get(row.gameId);
            if (!current || row.day < current)
                earliest.set(row.gameId, row.day);
        }

        return earliest;
    }

    private libraryStartDay(
        startedAt: Date | null | undefined,
        period: RecapPeriod,
    ) {
        if (!startedAt) return null;
        const started = dayjs.utc(startedAt);
        return started.isBefore(period.startDate) ||
            started.isAfter(period.endDate)
            ? null
            : started.format("YYYY-MM-DD");
    }

    private isWithinPeriod(date: Date | null | undefined, period: RecapPeriod) {
        if (!date) return false;
        const value = dayjs.utc(date);
        return (
            !value.isBefore(period.startDate) && !value.isAfter(period.endDate)
        );
    }

    private async getPlayedGamesInPeriod(
        userId: string,
        period: RecapPeriod,
        entriesPlayed: CollectionEntry[],
        dailyPlaytime: DailyPlaytime[],
        reviews: RecapReview[],
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
                const percentOfTotalPlaytime =
                    parseFloat(percentageInPeriod.toFixed(4)) || 0;
                const percentOfTotalPlaytimeFormatted = (
                    percentageInPeriod * 100
                ).toFixed(2);

                return {
                    ...playtime,
                    totalPlaytimeSeconds: playtime.totalPlaytimeInPeriodSeconds,
                    percentOfTotalPlaytime: percentOfTotalPlaytime,
                    percentOfTotalPlaytimeFormatted:
                        percentOfTotalPlaytimeFormatted,
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

        const gameIds = Array.from(
            new Set(
                playedGamesParsed
                    .map((game) => game.gameId)
                    .filter((gameId): gameId is number => gameId != null),
            ),
        );
        const entryDetails = await this.getCollectionEntryDetails(
            userId,
            gameIds,
        );
        const earliestPlayedDay = this.earliestPlayedDayByGame(dailyPlaytime);
        const ratingByGame = new Map(
            reviews.map((review) => [review.gameId, Number(review.rating)]),
        );

        for (const game of playedGamesParsed) {
            if (game.gameId == null) continue;

            const details = entryDetails.get(game.gameId);
            game.firstPlayedAt =
                earliestPlayedDay.get(game.gameId) ??
                this.libraryStartDay(details?.startedAt, period);
            game.finishedAt = this.isWithinPeriod(details?.finishedAt, period)
                ? details!.finishedAt
                : null;
            game.rating = ratingByGame.get(game.gameId) ?? null;
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

        try {
            const [byMode, byGenre, byPlatform, byTheme] = await Promise.all([
                this.profileMetricsDistributionService.getTypeDistribution(
                    userId,
                    {
                        by: ProfileMetricsTypeDistributionBy.MODE,
                        year: year,
                    },
                ),
                this.profileMetricsDistributionService.getTypeDistribution(
                    userId,
                    {
                        by: ProfileMetricsTypeDistributionBy.GENRE,
                        year: year,
                    },
                ),
                this.profileMetricsDistributionService.getTypeDistribution(
                    userId,
                    {
                        by: ProfileMetricsTypeDistributionBy.PLATFORM,
                        year: year,
                    },
                ),
                this.profileMetricsDistributionService.getTypeDistribution(
                    userId,
                    {
                        by: ProfileMetricsTypeDistributionBy.THEME,
                        year: year,
                    },
                ),
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
        } catch (err) {
            this.logger.error(
                `Error fetching library distribution for user ${userId} and year ${year}`,
                err,
            );
        }

        return {
            modes: [],
            genres: [],
            platforms: [],
            themes: [],
        };
    }

    private async getReviewsInPeriod(userId: string, period: RecapPeriod) {
        const [reviews] = await this.reviewsService.findAllByUserId(userId, {
            limit: 9_999_999,
        });

        const totalReviews = reviews.filter((review) => {
            const createdAt = dayjs(review.createdAt);
            return (
                createdAt.isAfter(period.startDate) &&
                createdAt.isBefore(period.endDate)
            );
        });

        return {
            reviews: reviews as RecapReview[],
            totalCreatedReviews: totalReviews.length,
        };
    }

    /**
     * Compares the user's ratings with other reviewers of the same played games
     * (design 13). Returns the furthest and the closest opinions.
     */
    private async getCommunityHighlights(
        userId: string,
        playedGameIds: number[],
        reviews: RecapReview[],
    ): Promise<RecapCommunityHighlights> {
        const playedGames = new Set(playedGameIds);
        const userRatings = new Map<number, number>();
        for (const review of reviews) {
            if (playedGames.has(review.gameId)) {
                userRatings.set(review.gameId, Number(review.rating));
            }
        }

        if (userRatings.size === 0) {
            return { minority: null, inTune: null };
        }

        const candidates = Array.from(userRatings);
        const derivedRatings = candidates
            .map(() => "SELECT ? AS gameId, ? AS userRating")
            .join(" UNION ALL ");
        const rows = await this.dataSource.query(
            `SELECT r.gameId AS gameId, COUNT(*) AS reviewCount,
                AVG(r.rating) AS average,
                SUM(r.rating >= ur.userRating) AS atOrAbove,
                SUM(r.rating <= ur.userRating) AS atOrBelow,
                SUM(ABS(r.rating - ur.userRating) <= 0.5) AS sameRange
             FROM review r
             INNER JOIN (${derivedRatings}) ur ON ur.gameId = r.gameId
             WHERE r.profileUserId <> ?
             GROUP BY r.gameId
             HAVING COUNT(*) >= ?`,
            [
                ...candidates.flatMap(([gameId, rating]) => [gameId, rating]),
                userId,
                COMMUNITY_REVIEW_THRESHOLD,
            ],
        );

        const highlights: RecapCommunityHighlight[] = rows.map((row: any) => {
            const gameId = Number(row.gameId);
            const userRating = userRatings.get(gameId)!;
            const communityAverage = Number(row.average);
            const reviewCount = Number(row.reviewCount);
            const beyondCount =
                userRating >= communityAverage
                    ? Number(row.atOrAbove)
                    : Number(row.atOrBelow);

            return {
                gameId,
                userRating,
                communityAverage: round4(communityAverage),
                reviewCount,
                beyondShare:
                    reviewCount === 0 ? 0 : round4(beyondCount / reviewCount),
                sameRangeCount: Number(row.sameRange),
            };
        });

        if (highlights.length === 0) {
            return { minority: null, inTune: null };
        }

        highlights.sort(
            (a, b) =>
                Math.abs(b.userRating - b.communityAverage) -
                    Math.abs(a.userRating - a.communityAverage) ||
                a.gameId - b.gameId,
        );

        if (highlights.length === 1) {
            const highlight = highlights[0];
            return Math.abs(
                highlight.userRating - highlight.communityAverage,
            ) >= 1
                ? { minority: highlight, inTune: null }
                : { minority: null, inTune: highlight };
        }

        return {
            minority: highlights[0],
            inTune: highlights[highlights.length - 1],
        };
    }

    private toDailyPlaytimeSeconds(
        rows: DailyPlaytime[],
        period: RecapPeriod,
    ): number[] {
        const daily = Array.from(
            { length: period.endDate.diff(period.startDate, "day") + 1 },
            () => 0,
        );

        for (const row of rows) {
            const index = dayjs.utc(row.day).diff(period.startDate, "day");
            if (index < 0 || index >= daily.length) continue;
            daily[index] += row.seconds;
        }

        return daily;
    }

    private async getLikesPerformedInPeriod(
        userId: string,
        period: RecapPeriod,
    ) {
        const endExclusive = period.endDate.add(1, "millisecond").toDate();
        const [count] = await this.dataSource.query(
            `SELECT COUNT(*) AS total FROM statistics_event
            WHERE actorUserId = ? AND eventKind = 'like.added'
              AND occurredAt >= ? AND occurredAt < ?`,
            [userId, period.startDate.toDate(), endExclusive],
        );
        return {
            total: Number(count.total),
            completeSince: null,
            historyComplete: true,
        };
    }

    private async appendRecapMilestone(
        userId: string,
        year: number,
        milestone: "available" | "closed",
    ) {
        await appendNotificationIntent(this.dataSource.manager, {
            eventType: "recap.milestone",
            eventVersion: SUPPORTED_EVENT_VERSION,
            occurredAt: new Date(),
            recipientUserId: userId,
            actorUserId: null,
            payload: { year, milestone },
        });
    }

    private async insertRecapRelations(
        recapId: number,
        playedGames: Partial<YearRecapPlayedGame>[],
        distribution: Pick<
            DeepPartial<YearRecap>,
            "modes" | "genres" | "platforms" | "themes"
        >,
    ) {
        const manager = this.dataSource.manager;
        const rows = <T extends object>(items: T[] | undefined) =>
            (items ?? []).map((item) => ({ ...item, recapId }));

        if (playedGames.length > 0) {
            await manager
                .getRepository(YearRecapPlayedGame)
                .insert(rows(playedGames) as any);
        }
        if (distribution.genres?.length) {
            await manager
                .getRepository(YearRecapGenre)
                .insert(rows(distribution.genres) as any);
        }
        if (distribution.modes?.length) {
            await manager
                .getRepository(YearRecapMode)
                .insert(rows(distribution.modes) as any);
        }
        if (distribution.platforms?.length) {
            await manager
                .getRepository(YearRecapPlatform)
                .insert(rows(distribution.platforms) as any);
        }
        if (distribution.themes?.length) {
            await manager
                .getRepository(YearRecapTheme)
                .insert(rows(distribution.themes) as any);
        }
    }

    @Transactional()
    async createRecap(
        userId: string,
        year: number,
        { final }: { final: boolean },
    ) {
        // Watermark taken before the first read, so activity committed while this
        // Recap is generated stays newer than it and is selected for regeneration.
        // shortcut: an import that stamps an older observedAt and commits mid-generation is missed; upgrade if imports can outlive a generation.
        const snapshotStartedAt = new Date();
        // Lock before the first snapshot read so a waiting job sees any committed final Recap.
        await this.dataSource.manager.query(
            "SELECT userId FROM profile WHERE userId = ? FOR UPDATE",
            [userId],
        );
        const period = this.getTargetPeriod(year);
        const existing = await this.recapRepository.findOneBy({
            profileUserId: userId,
            year,
        });

        if (existing?.isFinal) {
            this.logger.log(
                `Yearly recap for user ${userId} and year ${year} is final. Skipping regeneration.`,
            );
            return;
        }

        this.logger.log(
            `Creating yearly recap for user ${userId} and year ${year}`,
        );

        const collectionsInPeriod = await this.getCollectionsInPeriod(
            userId,
            period,
        );
        const entriesInPeriod = await this.getCollectionEntriesInPeriod(
            userId,
            period,
        );
        const dailyPlaytime =
            await this.playtimeHistoryService.getDailyPlaytimeForPeriod(
                userId,
                period.startDate.toDate(),
                period.endDate.toDate(),
            );
        const reviewsInPeriod = await this.getReviewsInPeriod(userId, period);
        const playedGamesInPeriod = await this.getPlayedGamesInPeriod(
            userId,
            period,
            entriesInPeriod.playedInPeriod,
            dailyPlaytime,
            reviewsInPeriod.reviews,
        );
        const libraryCounts = await this.getLibraryCountsInPeriod(
            userId,
            period,
        );
        const communityHighlights = await this.getCommunityHighlights(
            userId,
            playedGamesInPeriod.playedGames
                .map((game) => game.gameId)
                .filter((gameId): gameId is number => gameId != null),
            reviewsInPeriod.reviews,
        );

        const distributionInPeriod = await this.getLibraryDistributionInPeriod(
            userId,
            period,
        );

        const followersGained = await this.followService.countFollowers(
            userId,
            {
                startDate: period.startDate.toDate(),
                endDate: period.endDate.toDate(),
            },
        );

        const likesInPeriod = await this.getLikesPerformedInPeriod(
            userId,
            period,
        );

        const entity = this.recapRepository.create({
            profileUserId: userId,
            year,
            // TODO
            totalLikesPerformed: likesInPeriod.total,
            likesHistoryComplete: likesInPeriod.historyComplete,
            likesCompleteSince: likesInPeriod.completeSince,
            totalReviewsCreated: reviewsInPeriod.totalCreatedReviews,
            totalFollowersGained: followersGained,
            totalCollectionsCreated: collectionsInPeriod.totalCreatedInPeriod,
            totalAddedGames: entriesInPeriod.totalCreatedInPeriod,
            totalFinishedGames: libraryCounts.finished,
            totalDroppedGames: libraryCounts.dropped,
            isFinal: final,
            updatedAt: snapshotStartedAt,
            totalPlaytimeSeconds:
                playedGamesInPeriod.totalPlaytimeInPeriodSeconds,
            totalPlayedGames: playedGamesInPeriod.playedGames.length,
            dailyPlaytimeSeconds: this.toDailyPlaytimeSeconds(
                dailyPlaytime,
                period,
            ),
            communityHighlights,
        });

        if (existing) {
            await this.recapRepository.delete(existing.id);
        }

        const saved = await this.recapRepository.save(entity);
        await this.insertRecapRelations(
            saved.id,
            playedGamesInPeriod.playedGames,
            distributionInPeriod,
        );

        await this.dataSource.queryResultCache?.remove([
            recapCacheId(userId, year),
        ]);

        const hasData =
            entity.totalPlayedGames > 0 || entity.totalAddedGames > 0;
        if (final && hasData) {
            await this.appendRecapMilestone(userId, year, "closed");
        } else if (!existing && hasData) {
            await this.appendRecapMilestone(userId, year, "available");
        }

        this.logger.log(
            `Yearly recap for user ${userId} and year ${year} created successfully.`,
        );
    }
}
