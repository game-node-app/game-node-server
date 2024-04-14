import { Injectable } from "@nestjs/common";
import { StatisticsService } from "./statistics.types";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, In, MoreThanOrEqual, Repository } from "typeorm";
import { FindStatisticsTrendingActivitiesDto } from "./dto/find-statistics-trending-activities.dto";
import { StatisticsPeriodToMinusDays } from "./statistics.constants";
import { getPreviousDate } from "./statistics.utils";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { Activity } from "../activities/activities-repository/entities/activity.entity";
import { minutes } from "@nestjs/throttler";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";

@Injectable()
export class ActivityStatisticsService implements StatisticsService {
    constructor(
        @InjectRepository(ActivityStatistics)
        private activityStatisticsRepository: Repository<ActivityStatistics>,
        @InjectRepository(UserLike)
        private userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private userViewRepository: Repository<UserView>,
    ) {}

    async create(sourceId: string): Promise<ActivityStatistics> {
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
        data: FindStatisticsTrendingActivitiesDto,
    ): Promise<TPaginationData<ActivityStatistics>> {
        const periodMinusDays = StatisticsPeriodToMinusDays[data.period];
        const periodDate = getPreviousDate(periodMinusDays);
        const baseFindOptions = buildBaseFindOptions<ActivityStatistics>(data);
        const activityFindOptionsWhere: FindOptionsWhere<Activity> = {
            id: data.activityId,
            profileUserId: data.userId,
            type: data.activityType,
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

    handleLike(data: StatisticsLikeAction): void {}

    handleView(data: StatisticsViewAction): void {}
}
