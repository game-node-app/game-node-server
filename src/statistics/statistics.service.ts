import { Injectable, Logger } from "@nestjs/common";
import { DataSource, EntityTarget, Repository } from "typeorm";
import {
    StatisticsCreateAction,
    StatisticsLikeAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { AnyStatistics } from "./statistics.types";
import {
    StatisticsActionType,
    StatisticsSourceType,
} from "./statistics.constants";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { CommentStatistics } from "./entity/comment-statistics.entity";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import {
    ENotificationCategory,
    NotificationSourceType,
} from "../notifications/notifications.constants";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import { PostStatistics } from "./entity/post-statistics.entity";
import { match, P } from "ts-pattern";

@Injectable()
export class StatisticsService {
    private readonly logger = new Logger(StatisticsService.name);
    private readonly userLikeRepository: Repository<UserLike>;
    private readonly userViewRepository: Repository<UserView>;

    constructor(
        private readonly dataSource: DataSource,
        private readonly notificationsQueueService: NotificationsQueueService,
    ) {
        this.userLikeRepository = dataSource.getRepository(UserLike);
        this.userViewRepository = dataSource.getRepository(UserView);
    }

    protected getTargetEntity<T extends AnyStatistics>(
        sourceType: StatisticsSourceType,
    ): EntityTarget<T> {
        return match(sourceType)
            .with(StatisticsSourceType.REVIEW, () => ReviewStatistics)
            .with(StatisticsSourceType.GAME, () => GameStatistics)
            .with(StatisticsSourceType.ACTIVITY, () => ActivityStatistics)
            .with(StatisticsSourceType.POST, () => PostStatistics)
            .with(
                P.union(
                    StatisticsSourceType.ACTIVITY_COMMENT,
                    StatisticsSourceType.REVIEW_COMMENT,
                    StatisticsSourceType.POST_COMMENT,
                ),
                () => CommentStatistics,
            )
            .exhaustive();
    }

    protected getTargetRepository<T extends AnyStatistics>(
        sourceType: StatisticsSourceType,
    ): Repository<T> {
        return this.dataSource.getRepository(this.getTargetEntity(sourceType));
    }

    protected getTargetRelationIdProperty(
        sourceType: StatisticsSourceType,
    ): string {
        return match(sourceType)
            .with(StatisticsSourceType.REVIEW, () => "reviewId")
            .with(StatisticsSourceType.GAME, () => "gameId")
            .with(StatisticsSourceType.ACTIVITY, () => "activityId")
            .with(StatisticsSourceType.POST, () => "postId")
            .with(
                StatisticsSourceType.ACTIVITY_COMMENT,
                () => "activityCommentId",
            )
            .with(StatisticsSourceType.REVIEW_COMMENT, () => "reviewCommentId")
            .with(StatisticsSourceType.POST_COMMENT, () => "postCommentId")
            .exhaustive();
    }

    /**
     * Returns the target relation on entities that inherit from {@link StatisticsAction}.
     * e.g.: UserLike and UserView
     *
     * @param sourceType
     * @protected
     */
    protected getTargetActionTableRelationProperty(
        sourceType: StatisticsSourceType,
    ) {
        return match<StatisticsSourceType, keyof (UserLike | UserView)>(
            sourceType,
        )
            .with(StatisticsSourceType.REVIEW, () => "reviewStatistics")
            .with(StatisticsSourceType.GAME, () => "gameStatistics")
            .with(StatisticsSourceType.ACTIVITY, () => "activityStatistics")
            .with(StatisticsSourceType.POST, () => "postStatistics")
            .with(
                P.union(
                    StatisticsSourceType.ACTIVITY_COMMENT,
                    StatisticsSourceType.REVIEW_COMMENT,
                    StatisticsSourceType.POST_COMMENT,
                ),
                () => "commentStatistics",
            )
            .exhaustive();
    }

    protected getTargetNotificationCategory(
        sourceType: StatisticsSourceType,
    ): NotificationSourceType {
        return match(sourceType)
            .with(
                StatisticsSourceType.REVIEW,
                () => NotificationSourceType.REVIEW,
            )
            .with(StatisticsSourceType.GAME, () => NotificationSourceType.GAME)
            .with(
                StatisticsSourceType.ACTIVITY,
                () => NotificationSourceType.ACTIVITY,
            )
            .with(StatisticsSourceType.POST, () => NotificationSourceType.POST)
            .with(
                StatisticsSourceType.ACTIVITY_COMMENT,
                () => NotificationSourceType.ACTIVITY_COMMENT,
            )
            .with(
                StatisticsSourceType.REVIEW_COMMENT,
                () => NotificationSourceType.REVIEW_COMMENT,
            )
            .with(
                StatisticsSourceType.POST_COMMENT,
                () => NotificationSourceType.POST_COMMENT,
            )
            .exhaustive();
    }

    async findOne<T>(
        sourceId: string | number,
        sourceType: StatisticsSourceType,
    ): Promise<T | null> {
        const targetRelation = this.getTargetRelationIdProperty(sourceType);

        return (await this.getTargetRepository(sourceType).findOneBy({
            [targetRelation]: sourceId,
        })) as T | null;
    }

    async create<T extends AnyStatistics>(
        data: StatisticsCreateAction,
    ): Promise<T> {
        const existingEntity = await this.findOne<T>(
            data.sourceId,
            data.sourceType,
        );

        if (existingEntity) return existingEntity;

        const targetRelation = this.getTargetRelationIdProperty(
            data.sourceType,
        );

        return (await this.getTargetRepository(data.sourceType).save({
            [targetRelation]: data.sourceId,
        })) as unknown as T;
    }

    async handleLike(data: StatisticsLikeAction) {
        const { sourceId, userId, action, sourceType } = data;
        const entry = await this.create({
            sourceId,
            sourceType: sourceType,
        });

        const targetRepository = this.getTargetRepository(sourceType);

        const targetActionRelation =
            this.getTargetActionTableRelationProperty(sourceType);

        const isLiked = await this.userLikeRepository.existsBy({
            profileUserId: userId,
            [targetActionRelation]: entry,
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
                [targetActionRelation]: entry,
            });

            if (entry.likesCount > 0) {
                await targetRepository.decrement(
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
            [targetActionRelation]: entry,
        });

        await targetRepository.increment(
            {
                id: entry.id,
            },
            "likesCount",
            1,
        );

        this.createLikeNotification(data);
    }

    private createLikeNotification(data: StatisticsLikeAction) {
        const { sourceId, sourceType, targetUserId, userId } = data;

        if (targetUserId == undefined) {
            return;
        }

        const notificationSourceType =
            this.getTargetNotificationCategory(sourceType);

        this.notificationsQueueService.registerNotification({
            sourceId,
            sourceType: notificationSourceType,
            category: ENotificationCategory.LIKE,
            userId,
            targetUserId,
        });
    }

    async handleView(data: StatisticsViewAction) {
        const { userId, sourceId, sourceType } = data;
        let idToUse: number;
        if (typeof sourceId !== "number") {
            idToUse = parseInt(sourceId, 10);
        } else {
            idToUse = sourceId;
        }

        const entry = await this.create({
            sourceId: idToUse,
            sourceType: sourceType,
        });

        const targetRepository = this.getTargetRepository(sourceType);

        const targetActionRelation =
            this.getTargetActionTableRelationProperty(sourceType);

        await this.userViewRepository.save({
            profile: {
                userId: userId,
            },
            [targetActionRelation]: entry,
        });

        await targetRepository.increment(
            {
                id: entry.id,
            },
            "viewsCount",
            1,
        );
    }

    async getStatus(
        statisticsId: number,
        sourceType: StatisticsSourceType,
        userId?: string,
    ): Promise<StatisticsStatus> {
        const targetActionRelation =
            this.getTargetActionTableRelationProperty(sourceType);

        if (userId) {
            const isLikedQuery = this.userLikeRepository.exists({
                where: {
                    [targetActionRelation]: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const isViewedQuery = this.userViewRepository.exists({
                where: {
                    [targetActionRelation]: {
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
