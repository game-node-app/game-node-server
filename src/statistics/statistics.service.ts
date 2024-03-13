import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import {
    Between,
    FindManyOptions,
    FindOptionsWhere,
    Repository,
} from "typeorm";
import { Statistics } from "./entity/statistics.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import {
    StatisticsActionType,
    StatisticsPeriod,
    StatisticsPeriodToMinusDays,
    StatisticsSourceType,
} from "./statistics.constants";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { StatisticsActionDto } from "./statistics-queue/dto/statistics-action.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import { FindStatisticsTrendingGamesDto } from "./dto/find-statistics-trending-games.dto";
import { buildFilterFindOptions } from "../sync/igdb/utils/build-filter-find-options";
import { FindStatisticsTrendingReviewsDto } from "./dto/find-statistics-trending-reviews.dto";
import { Review } from "../reviews/entities/review.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";

@Injectable()
export class StatisticsService {
    constructor(
        @InjectRepository(Statistics)
        private readonly statisticsRepository: Repository<Statistics>,
        @InjectRepository(UserLike)
        private readonly userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private readonly userViewRepository: Repository<UserView>,
        private readonly notificationsQueueService: NotificationsQueueService,
    ) {}

    public async create(data: StatisticsActionDto) {
        const possibleEntity = await this.findOneBySourceIdAndType(
            data.sourceId,
            data.sourceType,
        );
        if (possibleEntity) {
            return possibleEntity;
        }

        const statisticsEntity = this.statisticsRepository.create({
            sourceType: data.sourceType,
            viewsCount: 0,
            likesCount: 0,
        });

        switch (data.sourceType) {
            case StatisticsSourceType.GAME:
                if (typeof data.sourceId !== "number") {
                    data.sourceId = parseInt(data.sourceId, 10);
                }
                statisticsEntity.gameId = data.sourceId as number;
                break;
            case StatisticsSourceType.REVIEW:
                if (typeof data.sourceId !== "string") {
                    throw new HttpException(
                        "Invalid type for sourceId",
                        HttpStatus.BAD_REQUEST,
                    );
                }
                statisticsEntity.reviewId = data.sourceId as string;
                break;
            default:
                throw new HttpException(
                    "Invalid type for sourceType",
                    HttpStatus.BAD_REQUEST,
                );
        }

        return await this.statisticsRepository.save(statisticsEntity);
    }

    async findOneBySourceIdAndType(
        sourceId: string | number,
        sourceType: StatisticsSourceType,
    ) {
        const options: FindManyOptions<Statistics> = {
            where: {
                sourceType,
            },
        };
        switch (sourceType) {
            case StatisticsSourceType.GAME:
                options.where = {
                    ...options.where,
                    gameId: sourceId as number,
                };
                break;
            case StatisticsSourceType.REVIEW:
                options.where = {
                    ...options.where,
                    reviewId: sourceId as string,
                };
                break;
            default:
                throw new HttpException(
                    "Invalid type for sourceType",
                    HttpStatus.BAD_REQUEST,
                );
        }
        return await this.statisticsRepository.findOne(options);
    }

    async handleLike(data: StatisticsLikeAction) {
        const { sourceId, sourceType, userId, targetUserId, action } = data;
        let statisticsEntity = await this.findOneBySourceIdAndType(
            sourceId,
            sourceType,
        );

        if (!statisticsEntity) {
            if (action === StatisticsActionType.DECREMENT) {
                throw new HttpException(
                    "User has not yet liked this item.",
                    HttpStatus.NOT_ACCEPTABLE,
                );
            }
            statisticsEntity = await this.create(data);
        }
        const isLiked = await this.userLikeRepository.exist({
            where: {
                profile: {
                    userId: userId,
                },
                statistics: {
                    id: statisticsEntity.id,
                },
            },
        });

        if (action === StatisticsActionType.INCREMENT && isLiked) {
            throw new HttpException(
                "User has already liked this item.",
                HttpStatus.NOT_ACCEPTABLE,
            );
        }

        if (action === StatisticsActionType.INCREMENT) {
            // This will fail if the user doesn't have a profile.
            await this.userLikeRepository.save({
                profile: {
                    userId,
                },
                statistics: statisticsEntity,
            });

            await this.statisticsRepository.increment(
                {
                    id: statisticsEntity.id,
                },
                "likesCount",
                1,
            );

            if (targetUserId) {
                this.notificationsQueueService.registerNotification({
                    sourceType:
                        this.sourceTypeToNotificationSourceType(sourceType),
                    sourceId: sourceId,
                    userId: userId,
                    targetUserId: targetUserId,
                    category: ENotificationCategory.LIKE,
                });
            }

            return;
        }

        if (statisticsEntity.likesCount > 0) {
            await this.statisticsRepository.decrement(
                {
                    id: statisticsEntity.id,
                },
                "likesCount",
                1,
            );
        }

        await this.userLikeRepository.delete({
            profile: {
                userId,
            },
            statistics: statisticsEntity,
        });
    }

    async handleView(data: StatisticsViewAction) {
        const { userId, sourceId, sourceType } = data;
        let statisticsEntity = await this.findOneBySourceIdAndType(
            sourceId,
            sourceType,
        );
        if (!statisticsEntity) {
            statisticsEntity = await this.create(data);
        }
        await this.statisticsRepository.increment(
            {
                id: statisticsEntity.id,
            },
            "viewsCount",
            1,
        );

        await this.userViewRepository.save({
            profile: {
                userId,
            },
            statistics: statisticsEntity,
        });
    }

    private sourceTypeToNotificationSourceType(
        sourceType: StatisticsSourceType,
    ) {
        switch (sourceType) {
            case StatisticsSourceType.REVIEW:
                return ENotificationSourceType.REVIEW;
            case StatisticsSourceType.GAME:
                return ENotificationSourceType.GAME;
        }
    }

    private getPreviousDate(daysMinus: number) {
        const previousDate = new Date(); // today
        // If this is a negative number, months are automatically subtracted
        previousDate.setDate(previousDate.getDate() - daysMinus);
        return previousDate;
    }

    private async findTrendingItems(
        baseFindOptions: FindManyOptions<Statistics>,
        period: StatisticsPeriod = StatisticsPeriod.WEEK,
        findWhereOptions?: FindOptionsWhere<Statistics>,
    ): Promise<TPaginationData<Statistics>> {
        // Avoids timezone-related issues
        // Just trust me
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const periodMinusDays = StatisticsPeriodToMinusDays[period];
        const periodDate = this.getPreviousDate(periodMinusDays);
        return await this.statisticsRepository.findAndCount({
            ...baseFindOptions,
            where: [
                {
                    ...findWhereOptions,
                    views: {
                        createdAt: Between(periodDate, tomorrow),
                    },
                },
                {
                    ...findWhereOptions,
                    likes: {
                        createdAt: Between(periodDate, tomorrow),
                    },
                },
                {
                    ...findWhereOptions,
                    likesCount: 0,
                    viewsCount: 0,
                },
            ],
            order: {
                likesCount: "DESC",
                viewsCount: "DESC",
            },
            relationLoadStrategy: "query",
        });
    }

    async findTrendingGames(dto: FindStatisticsTrendingGamesDto) {
        const findOptions = buildBaseFindOptions(dto);
        const findOptionsGameWhere = buildFilterFindOptions(dto.criteria);
        const findOptionsWhere: FindOptionsWhere<Statistics> = {
            sourceType: StatisticsSourceType.GAME,
            game: findOptionsGameWhere,
        };
        return await this.findTrendingItems(
            findOptions,
            dto.period,
            findOptionsWhere,
        );
    }

    async findTrendingReviews(dto: FindStatisticsTrendingReviewsDto) {
        const baseFindOptions = buildBaseFindOptions(dto);
        const reviewFindOptionsWhere: FindOptionsWhere<Review> | undefined =
            dto.gameId
                ? {
                      gameId: dto.gameId,
                  }
                : undefined;
        const findOptionsWhere: FindOptionsWhere<Statistics> = {
            sourceType: StatisticsSourceType.REVIEW,
            review: reviewFindOptionsWhere,
        };
        return await this.findTrendingItems(
            baseFindOptions,
            dto.period,
            findOptionsWhere,
        );
    }

    async findStatus(
        statisticsId: number,
        userId?: string,
    ): Promise<StatisticsStatus> {
        if (userId) {
            const isLikedQuery = this.userLikeRepository.exist({
                where: {
                    statistics: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const isViewedQuery = this.userViewRepository.exist({
                where: {
                    statistics: {
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
}
