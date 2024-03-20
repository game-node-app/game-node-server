import {
    HttpException,
    HttpStatus,
    Inject,
    Injectable,
    Logger,
} from "@nestjs/common";
import {
    FindManyOptions,
    FindOptionsWhere,
    MoreThanOrEqual,
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
import { FindStatisticsTrendingReviewsDto } from "./dto/find-statistics-trending-reviews.dto";
import { Review } from "../reviews/entities/review.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import { days } from "@nestjs/throttler";
import { buildFilterFindOptions } from "../sync/igdb/utils/build-filter-find-options";
import { CACHE_MANAGER, Cache } from "@nestjs/cache-manager";

@Injectable()
export class StatisticsService {
    private readonly logger = new Logger(StatisticsService.name);

    constructor(
        @Inject(CACHE_MANAGER)
        private readonly cacheManager: Cache,
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
        extraFindOptionsWhere: FindOptionsWhere<Statistics>,
        period: StatisticsPeriod = StatisticsPeriod.WEEK,
    ): Promise<TPaginationData<Statistics>> {
        const periodMinusDays = StatisticsPeriodToMinusDays[period];
        const periodDate = this.getPreviousDate(periodMinusDays);

        const items = await this.statisticsRepository.findAndCount({
            ...baseFindOptions,
            where: [
                {
                    ...extraFindOptionsWhere,
                    views: {
                        createdAt: MoreThanOrEqual(periodDate),
                    },
                },
                {
                    ...extraFindOptionsWhere,
                    likes: {
                        createdAt: MoreThanOrEqual(periodDate),
                    },
                },
                {
                    ...extraFindOptionsWhere,
                    likesCount: 0,
                    viewsCount: 0,
                },
            ],
            order: {
                likesCount: "DESC",
                viewsCount: "DESC",
            },
        });
        return items;
    }

    /**
     * This is slow, make sure it's cached with a big overhead.
     * NestJS and TypeORM's
     * @param dto
     */
    async findTrendingGames(dto: FindStatisticsTrendingGamesDto) {
        const baseFindOptions = buildBaseFindOptions(dto);
        baseFindOptions.relationLoadStrategy = "query";

        const gameFindOptionsWhere = buildFilterFindOptions(dto.criteria);

        const findOptionsWhere: FindOptionsWhere<Statistics> = {
            sourceType: StatisticsSourceType.GAME,
            game: gameFindOptionsWhere,
        };

        // It's better to use 'buildFilterFindOptions' as cache key because it removes unnecessary or empty parameters
        // from the dto.
        const cacheKey = `trending-games-${dto.period}-${JSON.stringify(gameFindOptionsWhere)}`;
        const resultInCache =
            await this.cacheManager.get<TPaginationData<Statistics>>(cacheKey);

        if (resultInCache) {
            return resultInCache;
        }
        const result = await this.findTrendingItems(
            baseFindOptions,
            findOptionsWhere,
            dto.period,
        );

        console.timeEnd("trending/games");

        this.cacheManager
            .set(cacheKey, result, days(1))
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
        return result;
    }

    async findTrendingReviews(dto: FindStatisticsTrendingReviewsDto) {
        const baseFindOptions = buildBaseFindOptions(dto);
        const reviewFindOptionsWhere: FindOptionsWhere<Review> = {
            gameId: dto?.gameId,
        };
        const findOptionsWhere: FindOptionsWhere<Statistics> = {
            sourceType: StatisticsSourceType.REVIEW,
            review: reviewFindOptionsWhere,
        };
        return await this.findTrendingItems(
            baseFindOptions,
            findOptionsWhere,
            dto.period,
        );
    }

    async findStatus(
        statisticsId: number,
        userId?: string,
    ): Promise<StatisticsStatus> {
        if (userId) {
            const isLikedQuery = this.userLikeRepository.exists({
                where: {
                    statistics: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const isViewedQuery = this.userViewRepository.exists({
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
