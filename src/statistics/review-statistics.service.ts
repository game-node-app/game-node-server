import { Injectable } from "@nestjs/common";
import { StatisticsService } from "./statistics.types";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import {
    StatisticsActionType,
    StatisticsPeriod,
    StatisticsPeriodToMinusDays,
    StatisticsSourceType,
} from "./statistics.constants";
import { FindStatisticsTrendingReviewsDto } from "./dto/find-statistics-trending-reviews.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { Review } from "../reviews/entities/review.entity";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";
import { hours } from "@nestjs/throttler";
import { getPreviousDate } from "./statistics.utils";
import { Cacheable } from "../utils/cacheable";
import { Cache } from "@nestjs/cache-manager";

@Injectable()
export class ReviewStatisticsService implements StatisticsService {
    constructor(
        private readonly cacheManager: Cache,
        @InjectRepository(ReviewStatistics)
        private readonly reviewStatisticsRepository: Repository<ReviewStatistics>,
        @InjectRepository(UserLike)
        private readonly userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private readonly userViewRepository: Repository<UserView>,
        private readonly notificationsQueueService: NotificationsQueueService,
    ) {}

    public async create(data: StatisticsCreateAction) {
        const sourceId = data.sourceId as string;
        const entry = await this.findOne(sourceId);
        if (entry) return entry;

        return await this.reviewStatisticsRepository.save({
            reviewId: sourceId,
        });
    }

    public async findOne(sourceId: string) {
        return await this.reviewStatisticsRepository.findOneBy({
            reviewId: sourceId,
        });
    }

    public async handleLike(data: StatisticsLikeAction): Promise<void> {
        const { sourceId, userId, targetUserId, action } = data;
        if (typeof sourceId !== "string") {
            throw new Error("Invalid type for review-statistics like");
        }

        const entry = await this.create({
            sourceId: sourceId as string,
            sourceType: StatisticsSourceType.REVIEW,
        });

        const isLiked = await this.userLikeRepository.existsBy({
            profileUserId: userId,
            reviewStatistics: entry,
        });

        const invalidIncrement =
            action === StatisticsActionType.INCREMENT && isLiked;
        const invalidDecrement =
            action === StatisticsActionType.DECREMENT && !isLiked;

        if (invalidIncrement || invalidDecrement) {
            return;
        }

        if (action === StatisticsActionType.DECREMENT) {
            await this.userLikeRepository.delete({
                profile: {
                    userId,
                },
                reviewStatistics: entry,
            });

            if (entry.likesCount > 0) {
                await this.reviewStatisticsRepository.decrement(
                    {
                        id: entry.id,
                    },
                    "likesCount",
                    1,
                );
            }

            return;
        }

        // This will fail if the user doesn't have a profile.
        await this.userLikeRepository.save({
            profile: {
                userId,
            },
            reviewStatistics: entry,
        });

        await this.reviewStatisticsRepository.increment(
            {
                id: entry.id,
            },
            "likesCount",
            1,
        );

        if (targetUserId) {
            this.notificationsQueueService.registerNotification({
                targetUserId,
                userId,
                sourceId: sourceId,
                sourceType: ENotificationSourceType.REVIEW,
                category: ENotificationCategory.LIKE,
            });
        }
    }

    public async handleView(data: StatisticsViewAction): Promise<void> {
        const { userId, sourceId } = data;
        if (typeof sourceId !== "string") {
            throw new Error("Invalid type for review-statistics view");
        }

        const entry = await this.create({
            sourceId,
            sourceType: StatisticsSourceType.REVIEW,
        });

        await this.userViewRepository.save({
            profile: {
                userId: userId,
            },
            reviewStatistics: entry,
        });

        await this.reviewStatisticsRepository.increment(
            {
                reviewId: sourceId,
            },
            "viewsCount",
            1,
        );
    }

    public async getStatus(
        statisticsId: number,
        userId: string | undefined,
    ): Promise<StatisticsStatus> {
        if (userId) {
            const isLikedQuery = this.userLikeRepository.exists({
                where: {
                    reviewStatistics: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const isViewedQuery = this.userViewRepository.exists({
                where: {
                    reviewStatistics: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const [isLiked, isViewed] = await Promise.all([
                isLikedQuery,
                isViewedQuery,
            ]);

            return {
                isLiked,
                isViewed,
            };
        }

        return {
            isLiked: false,
            isViewed: false,
        };
    }

    /**
     * Finds trending reviews, giving preference to most 'liked' in 'period'.
     * @param dto
     */
    @Cacheable(ReviewStatisticsService.name, hours(1))
    public async findTrending(
        dto: FindStatisticsTrendingReviewsDto,
    ): Promise<TPaginationData<ReviewStatistics>> {
        const baseFindOptions = buildBaseFindOptions<ReviewStatistics>(dto);

        const periodMinusDays = StatisticsPeriodToMinusDays[dto.period];
        const periodStartDate = getPreviousDate(periodMinusDays);

        const likesInPeriodSubQuery = this.userLikeRepository
            .createQueryBuilder("ul")
            .select("ul.reviewStatisticsId, COUNT(ul.id) as total")
            .where("ul.reviewStatisticsId IS NOT NULL")
            .groupBy("ul.reviewStatisticsId");

        // Improves performance by only querying with createdAt date
        // when necessary
        if (dto.period !== StatisticsPeriod.ALL) {
            likesInPeriodSubQuery.andWhere("ul.createdAt >= :periodStartDate");
        }

        const statisticsQuery = this.reviewStatisticsRepository
            .createQueryBuilder("rs")
            .addSelect("IFNULL(in_period.total, 0) AS likes_in_period")
            .leftJoin(
                `(${likesInPeriodSubQuery.getQuery()})`,
                "in_period",
                "in_period.reviewStatisticsId = rs.id",
            )
            .orderBy("likes_in_period", "DESC")
            .addOrderBy("rs.likesCount", "DESC")
            .skip(baseFindOptions.skip)
            .limit(baseFindOptions.take);

        if (dto.userId || dto.gameId || dto.reviewId) {
            statisticsQuery.innerJoinAndSelect(
                Review,
                "r",
                "r.id = rs.reviewId",
            );
            // statisticsQuery.addSelect("r.id, r.profileUserId, r.gameId");

            if (dto.userId) {
                statisticsQuery.andWhere("r.profileUserId = :userId");
            }
            if (dto.gameId) {
                statisticsQuery.andWhere("r.gameId = :gameId");
            }
            if (dto.reviewId) {
                statisticsQuery.andWhere("r.id = :reviewId");
            }
        }

        // Sets all parameters for query and subqueries
        statisticsQuery.setParameters({
            periodStartDate: periodStartDate,
            userId: dto.userId,
            gameId: dto.gameId,
            reviewId: dto.reviewId,
        });

        return await statisticsQuery.getManyAndCount();
    }
}
