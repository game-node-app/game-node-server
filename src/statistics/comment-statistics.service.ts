import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { CommentStatistics } from "./entity/comment-statistics.entity";
import { StatisticsService } from "./statistics.types";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { Repository } from "typeorm";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import {
    StatisticsActionType,
    StatisticsSourceType,
} from "./statistics.constants";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";

type CommentEntityKeys = keyof CommentStatistics;

@Injectable()
export class CommentStatisticsService implements StatisticsService {
    constructor(
        @InjectRepository(CommentStatistics)
        private readonly commentStatisticsRepository: Repository<CommentStatistics>,
        @InjectRepository(UserLike)
        private userLikeRepository: Repository<UserLike>,
        @InjectRepository(UserView)
        private userViewRepository: Repository<UserView>,
        private notificationsQueueService: NotificationsQueueService,
    ) {}

    private getTargetRelationProperty(
        sourceType: StatisticsSourceType,
    ): CommentEntityKeys {
        switch (sourceType) {
            case StatisticsSourceType.REVIEW_COMMENT:
                return "reviewCommentId";

            default:
                throw new Error("Invalid source type for comment statistics");
        }
    }

    async create(data: StatisticsCreateAction): Promise<CommentStatistics> {
        const { sourceId, sourceType } = data;
        if (typeof sourceId !== "string") {
            throw new Error("Invalid sourceId type for comment statistics");
        }

        const existingEntry = await this.findOne(sourceId, sourceType);
        if (existingEntry) {
            return existingEntry;
        }

        const targetRelationProperty =
            this.getTargetRelationProperty(sourceType);

        return await this.commentStatisticsRepository.save({
            [targetRelationProperty]: sourceId,
        });
    }

    async findOne(
        sourceId: string,
        sourceType: StatisticsSourceType,
    ): Promise<CommentStatistics | null> {
        const targetRelationProperty =
            this.getTargetRelationProperty(sourceType);

        return this.commentStatisticsRepository.findOneBy({
            [targetRelationProperty]: sourceId,
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    findTrending(data: any): Promise<TPaginationData<CommentStatistics>> {
        return Promise.resolve([[], 0]);
    }

    async getStatus(
        statisticsId: number,
        userId: string | undefined,
    ): Promise<StatisticsStatus> {
        if (userId) {
            const isLikedQuery = this.userLikeRepository.exists({
                where: {
                    commentStatistics: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const isViewedQuery = this.userViewRepository.exists({
                where: {
                    commentStatistics: {
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

    async handleLike(data: StatisticsLikeAction): Promise<void> {
        const { sourceId, userId, targetUserId, action, sourceType } = data;
        if (typeof sourceId !== "string") {
            throw new Error("Invalid type for review-statistics like");
        }

        const entry = await this.create({
            sourceId,
            sourceType: sourceType,
        });

        const isLiked = await this.userLikeRepository.existsBy({
            profileUserId: userId,
            commentStatistics: entry,
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
                commentStatistics: entry,
            });

            if (entry.likesCount > 0) {
                await this.commentStatisticsRepository.decrement(
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
            commentStatistics: entry,
        });

        await this.commentStatisticsRepository.increment(
            {
                id: entry.id,
            },
            "likesCount",
            1,
        );

        if (targetUserId) {
            // TODO: Handle notifications
            // this.notificationsQueueService.registerNotification({
            //     targetUserId,
            //     userId,
            //     sourceId: sourceId,
            //     sourceType: ENotificationSourceType.ACTIVITY,
            //     category: ENotificationCategory.LIKE,
            // });
        }
    }

    async handleView(data: StatisticsViewAction): Promise<void> {
        const { userId, sourceId, sourceType } = data;
        if (typeof sourceId !== "string") {
            throw new Error("Invalid type for activity-statistics view");
        }

        const entry = await this.create({
            sourceId,
            sourceType: sourceType,
        });

        await this.userViewRepository.save({
            profile: {
                userId: userId,
            },
            commentStatistics: entry.id,
        });

        await this.commentStatisticsRepository.increment(
            {
                id: entry.id,
            },
            "viewsCount",
            1,
        );
    }
}
