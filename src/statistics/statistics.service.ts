import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { Between, Repository } from "typeorm";
import { Statistics } from "./entity/statistics.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import {
    StatisticsActionType,
    StatisticsSourceType,
} from "./statistics.constants";
import {
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { FindStatisticsDto } from "./dto/find-statistics.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";

@Injectable()
export class StatisticsService {
    constructor(
        @InjectRepository(Statistics)
        private readonly statisticsRepository: Repository<Statistics>,
        @InjectRepository(UserLike)
        private readonly userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private readonly userViewRepository: Repository<UserView>,
    ) {}

    async handleLike(data: StatisticsLikeAction) {
        const { sourceId, sourceType, userId, action } = data;
        const likeEntity = await this.userLikeRepository.findOneBy({
            profile: {
                userId: userId,
            },
            statistics: {
                sourceId: sourceId,
                sourceType: sourceType,
            },
        });
        if (likeEntity) {
            throw new HttpException(
                "User has already liked this item.",
                HttpStatus.NOT_ACCEPTABLE,
            );
        }

        let statisticsEntity = await this.statisticsRepository.findOneBy({
            sourceType: sourceType,
            sourceId: sourceId,
        });
        if (!statisticsEntity) {
            if (action === StatisticsActionType.DECREMENT) {
                throw new HttpException(
                    "User has not yet liked this item.",
                    HttpStatus.NOT_ACCEPTABLE,
                );
            }
            statisticsEntity = await this.statisticsRepository.save({
                sourceId,
                sourceType,
                likesCount: 0,
            });
        }

        if (action === StatisticsActionType.INCREMENT) {
            await this.statisticsRepository.increment(
                {
                    sourceType,
                    sourceId,
                },
                "likesCount",
                1,
            );
            // This will fail if the user doesn't have a profile.
            await this.userLikeRepository.save({
                profile: {
                    userId,
                },
                statistics: statisticsEntity,
            });
            return;
        }

        await this.statisticsRepository.decrement(
            {
                sourceType,
                sourceId,
            },
            "likesCount",
            1,
        );
        await this.userLikeRepository.delete({
            profile: {
                userId,
            },
            statistics: statisticsEntity,
        });
    }

    async handleView(data: StatisticsViewAction) {
        const { userId, sourceId, sourceType } = data;
        let statisticsEntity = await this.statisticsRepository.findOneBy({
            sourceType,
            sourceId,
        });
        if (!statisticsEntity) {
            statisticsEntity = await this.statisticsRepository.save({
                sourceId,
                sourceType,
                viewsCount: 0,
            });
        }
        await this.statisticsRepository.increment(
            {
                sourceType,
                sourceId,
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

    /**
     * Finds trending items in the last week/month.
     * Do NOT return source entities here. The client should use the respective endpoints to retrieve it.
     * @param dto
     */
    async findTrending(
        dto: FindStatisticsDto,
    ): Promise<TPaginationData<Statistics>> {
        // Avoids timezone-related issues
        // Just trust me
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const lastWeek = new Date();
        const lastMonth = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        lastMonth.setDate(lastMonth.getDate() - 30);
        const findOptions = buildBaseFindOptions<Statistics>(dto);
        const [lastWeekStatistics, lastWeekCount] =
            await this.statisticsRepository.findAndCount({
                ...findOptions,
                where: [
                    {
                        views: {
                            createdAt: Between(lastWeek, tomorrow),
                        },
                    },
                    {
                        likes: {
                            createdAt: Between(lastWeek, tomorrow),
                        },
                    },
                ],
                order: {
                    viewsCount: "DESC",
                    likesCount: "DESC",
                },
            });

        if (lastWeekCount > 0) {
            return [lastWeekStatistics, lastWeekCount];
        }

        const [lastMonthStatistics, lastMonthCount] =
            await this.statisticsRepository.findAndCount({
                ...findOptions,
                where: [
                    {
                        views: {
                            createdAt: Between(lastMonth, tomorrow),
                        },
                    },
                    {
                        likes: {
                            createdAt: Between(lastMonth, tomorrow),
                        },
                    },
                ],
                order: {
                    viewsCount: "DESC",
                    likesCount: "DESC",
                },
            });
        return [lastMonthStatistics, lastMonthCount];
    }
}
