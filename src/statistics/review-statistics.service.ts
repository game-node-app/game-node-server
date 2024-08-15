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
import {
    FindOptionsWhere,
    LessThanOrEqual,
    MoreThanOrEqual,
    Repository,
} from "typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import {
    StatisticsActionType,
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
import { minutes } from "@nestjs/throttler";
import { getPreviousDate } from "./statistics.utils";

@Injectable()
export class ReviewStatisticsService implements StatisticsService {
    constructor(
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

    public async findTrending(
        dto: FindStatisticsTrendingReviewsDto,
    ): Promise<TPaginationData<any>> {
        const baseFindOptions = buildBaseFindOptions(dto);
        const reviewFindOptionsWhere: FindOptionsWhere<Review> = {
            gameId: dto?.gameId,
            profileUserId: dto?.userId,
            id: dto?.reviewId,
        };
        const findOptionsWhere: FindOptionsWhere<ReviewStatistics> = {
            review: reviewFindOptionsWhere,
        };
        const periodMinusDays = StatisticsPeriodToMinusDays[dto.period];
        const periodDate = getPreviousDate(periodMinusDays);
        const reviewsMinimumLikeCounts = 1;
        return await this.reviewStatisticsRepository.findAndCount({
            ...baseFindOptions,
            where: [
                {
                    ...findOptionsWhere,
                    likes: {
                        createdAt: MoreThanOrEqual(periodDate),
                    },
                },
                {
                    ...findOptionsWhere,
                    likesCount: LessThanOrEqual(reviewsMinimumLikeCounts),
                },
            ],
            order: {
                likesCount: "DESC",
            },
            cache: {
                id: `review-statistics-${JSON.stringify(findOptionsWhere)}`,
                milliseconds: minutes(5),
            },
        });
    }
}
