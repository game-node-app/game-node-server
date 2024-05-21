import { Injectable } from "@nestjs/common";
import { StatisticsService } from "./statistics.types";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, In, MoreThanOrEqual, Repository } from "typeorm";
import { FindStatisticsTrendingActivitiesDto } from "./dto/find-statistics-trending-activities.dto";
import {
    StatisticsActionType,
    StatisticsPeriodToMinusDays,
    StatisticsSourceType,
} from "./statistics.constants";
import { getPreviousDate } from "./statistics.utils";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { Activity } from "../activities/activities-repository/entities/activity.entity";
import { minutes } from "@nestjs/throttler";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";

@Injectable()
export class ActivityStatisticsService implements StatisticsService {
    constructor(
        @InjectRepository(ActivityStatistics)
        private activityStatisticsRepository: Repository<ActivityStatistics>,
        @InjectRepository(UserLike)
        private userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private userViewRepository: Repository<UserView>,
        private notificationsQueueService: NotificationsQueueService,
    ) {}

    async create(data: StatisticsCreateAction): Promise<ActivityStatistics> {
        const sourceId = data.sourceId as string;

        const existingEntity = await this.findOne(sourceId);
        if (existingEntity) return existingEntity;

        return await this.activityStatisticsRepository.save({
            activityId: sourceId,
            likesCount: 0,
            viewsCount: 0,
        });
    }

    findOne(sourceId: string): Promise<ActivityStatistics | null> {
        return this.activityStatisticsRepository.findOneBy({
            activityId: sourceId,
        });
    }

    findTrending(
        dto: FindStatisticsTrendingActivitiesDto,
    ): Promise<TPaginationData<ActivityStatistics>> {
        const periodMinusDays = StatisticsPeriodToMinusDays[dto.period];
        const periodDate = getPreviousDate(periodMinusDays);
        const baseFindOptions = buildBaseFindOptions<ActivityStatistics>(dto);
        const activityFindOptionsWhere: FindOptionsWhere<Activity> = {
            id: dto.activityId,
            profileUserId: dto.userId,
            type: dto.activityType,
        };
        const baseFindOptionsWhere: FindOptionsWhere<ActivityStatistics> = {
            activity: activityFindOptionsWhere,
        };
        // Includes activities liked by no one or the user itself
        const activityMinimumLikeCounts = [0, 1];
        return this.activityStatisticsRepository.findAndCount({
            ...baseFindOptions,
            where: [
                {
                    ...baseFindOptionsWhere,
                    likes: {
                        createdAt: MoreThanOrEqual(periodDate),
                    },
                },
                {
                    ...baseFindOptionsWhere,
                    likesCount: In(activityMinimumLikeCounts),
                },
            ],
            order: {
                likesCount: "DESC",
            },
            cache: {
                id: `trending-activities-statistics`,
                milliseconds: minutes(5),
            },
        });
    }

    async getStatus(
        statisticsId: number,
        userId: string | undefined,
    ): Promise<StatisticsStatus> {
        if (userId) {
            const isLikedQuery = this.userLikeRepository.exists({
                where: {
                    activityStatistics: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const isViewedQuery = this.userViewRepository.exists({
                where: {
                    activityStatistics: {
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

    async handleLike(data: StatisticsLikeAction) {
        const { sourceId, userId, targetUserId, action } = data;
        if (typeof sourceId !== "string") {
            throw new Error("Invalid type for review-statistics like");
        }

        const entry = await this.create({
            sourceId,
            sourceType: StatisticsSourceType.ACTIVITY,
        });

        const isLiked = await this.userLikeRepository.existsBy({
            profileUserId: userId,
            activityStatistics: entry,
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
                activityStatistics: entry,
            });

            if (entry.likesCount > 0) {
                await this.activityStatisticsRepository.decrement(
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
            activityStatistics: entry,
        });

        await this.activityStatisticsRepository.increment(
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
                sourceType: ENotificationSourceType.ACTIVITY,
                category: ENotificationCategory.LIKE,
            });
        }
    }

    async handleView(data: StatisticsViewAction) {
        const { userId, sourceId } = data;
        if (typeof sourceId !== "string") {
            throw new Error("Invalid type for activity-statistics view");
        }

        const entry = await this.create({
            sourceId,
            sourceType: StatisticsSourceType.ACTIVITY,
        });

        await this.userViewRepository.save({
            profile: {
                userId: userId,
            },
            activityStatistics: entry,
        });

        await this.activityStatisticsRepository.increment(
            {
                id: entry.id,
            },
            "viewsCount",
            1,
        );
    }
}
