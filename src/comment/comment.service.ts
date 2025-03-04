import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { ReviewComment } from "./entity/review-comment.entity";
import { DataSource, IsNull, Repository } from "typeorm";
import { CreateCommentDto } from "./dto/create-comment.dto";
import {
    CommentSourceToStatisticsSource,
    CommentSourceType,
} from "./comment.constants";
import { StatisticsQueueService } from "../statistics/statistics-queue/statistics-queue.service";
import { FindAllCommentsDto } from "./dto/find-all-comments.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { DeleteCommentDto } from "./dto/delete-comment.dto";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import { ReviewsService } from "../reviews/reviews.service";
import {
    ENotificationCategory,
    NotificationSourceType,
} from "../notifications/notifications.constants";
import { BaseFindDto } from "../utils/base-find.dto";
import { UserComment } from "./entity/user-comment.entity";
import { ActivityComment } from "./entity/activity-comment.entity";
import { ActivitiesRepositoryService } from "../activities/activities-repository/activities-repository.service";
import { match, P } from "ts-pattern";
import { PostComment } from "./entity/post-comment.entity";
import { AnyComment } from "./comment.types";
import { PostsService } from "../posts/posts.service";
import { AnyCommentDto } from "./dto/comment.dto";

@Injectable()
export class CommentService {
    private logger = new Logger(CommentService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly statisticsQueueService: StatisticsQueueService,
        private readonly notificationsQueueService: NotificationsQueueService,
        private readonly reviewsService: ReviewsService,
        private readonly activitiesRepositoryService: ActivitiesRepositoryService,
        private readonly postsService: PostsService,
    ) {}

    private getTargetRepository(
        commentSourceType: CommentSourceType,
    ): Repository<AnyComment> {
        return match<CommentSourceType, Repository<any>>(commentSourceType)
            .with(CommentSourceType.REVIEW, () =>
                this.dataSource.getRepository(ReviewComment),
            )
            .with(CommentSourceType.ACTIVITY, () =>
                this.dataSource.getRepository(ActivityComment),
            )
            .with(CommentSourceType.POST, () =>
                this.dataSource.getRepository(PostComment),
            )
            .exhaustive();
    }

    private getTargetRelationIdProperty(commentSourceType: CommentSourceType) {
        return match(commentSourceType)
            .with(CommentSourceType.REVIEW, () => "reviewId")
            .with(CommentSourceType.ACTIVITY, () => "activityId")
            .with(CommentSourceType.POST, () => "postId")
            .exhaustive();
    }

    async findAll(
        dto: FindAllCommentsDto,
    ): Promise<TPaginationData<AnyCommentDto>> {
        const targetRepository = this.getTargetRepository(dto.sourceType);

        const baseFindOptions = buildBaseFindOptions(dto);

        switch (dto.sourceType) {
            case CommentSourceType.REVIEW:
                return await targetRepository.findAndCount({
                    ...baseFindOptions,
                    where: {
                        reviewId: dto.sourceId,
                        // Only returns top-level comments, excluding comments of comments in the main list
                        childOfId: IsNull(),
                    },
                    relations: {
                        // Includes comments of comments in a list in each element
                        parentOf: true,
                    },
                });
            case CommentSourceType.ACTIVITY:
                return await targetRepository.findAndCount({
                    ...baseFindOptions,
                    where: {
                        activityId: dto.sourceId,
                        // Only returns top-level comments, excluding comments of comments in the main list
                        childOfId: IsNull(),
                    },
                    relations: {
                        // Includes comments of comments in a list in each element
                        parentOf: true,
                    },
                });
            case CommentSourceType.POST:
                return await targetRepository.findAndCount({
                    ...baseFindOptions,
                    where: {
                        postId: dto.sourceId,
                        // Only returns top-level comments, excluding comments of comments in the main list
                        childOfId: IsNull(),
                    },
                    relations: {
                        // Includes comments of comments in a list in each element
                        parentOf: true,
                    },
                });
            default:
                throw new HttpException(
                    "Invalid source type for comment",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }

    async findOneById(
        sourceType: CommentSourceType,
        commentId: string,
    ): Promise<AnyCommentDto | null> {
        const targetRepository = this.getTargetRepository(sourceType);
        return targetRepository.findOneBy({
            id: commentId,
        });
    }

    async findOneByIdOrFail(
        sourceType: CommentSourceType,
        commentId: string,
    ): Promise<AnyCommentDto> {
        const comment = await this.findOneById(sourceType, commentId);
        if (!comment) {
            throw new HttpException(
                "No comment found for given criteria",
                HttpStatus.NOT_FOUND,
            );
        }

        return comment;
    }

    async findAllChildrenById(
        sourceType: CommentSourceType,
        commentId: string,
        dto: BaseFindDto<UserComment>,
    ): Promise<AnyCommentDto[]> {
        const targetRepository = this.getTargetRepository(sourceType);

        const baseFindOptions = buildBaseFindOptions(dto);

        return await targetRepository.find({
            ...baseFindOptions,
            where: {
                childOfId: commentId,
            },
        });
    }

    async create(userId: string, dto: CreateCommentDto) {
        const { sourceType, sourceId, content, childOf } = dto;

        if (childOf) {
            const mainComment = await this.findOneByIdOrFail(
                sourceType,
                childOf,
            );
            if (mainComment.childOfId != undefined) {
                throw new HttpException(
                    "Deep-nested comments are not allowed. Comments must be a children of a single comment.",
                    HttpStatus.BAD_REQUEST,
                );
            }
        }

        const targetRepository = this.getTargetRepository(sourceType);
        const targetRelationProperty =
            this.getTargetRelationIdProperty(sourceType);

        const insertedEntry = await targetRepository.save({
            profileUserId: userId,
            content,
            childOfId: childOf,
            [targetRelationProperty]: sourceId,
        });

        const statisticsSource =
            CommentSourceToStatisticsSource[dto.sourceType];

        this.statisticsQueueService.createStatistics({
            sourceType: statisticsSource,
            sourceId: insertedEntry.id,
        });

        this.createNotification(insertedEntry.id, sourceType)
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }

    /**
     * Registers notification for target entity (e.g. review, review comment) when a new comment is inserted.
     * @param commentId
     * @param sourceType
     */
    async createNotification(commentId: string, sourceType: CommentSourceType) {
        const comment = await this.findOneByIdOrFail(sourceType, commentId);

        let sourceId: string | undefined;

        let targetUserId: string;
        if (comment.childOfId != undefined) {
            const parentComment = await this.findOneByIdOrFail(
                sourceType,
                comment.childOfId,
            );
            targetUserId = parentComment.profileUserId;
            sourceId = parentComment.id;
        } else {
            const targetInfo = await match<
                CommentSourceType,
                Promise<{
                    targetUserId: string;
                    sourceId: string;
                }>
            >(sourceType)
                .with(CommentSourceType.REVIEW, async () => {
                    const review = await this.reviewsService.findOneByIdOrFail(
                        (comment as ReviewComment).reviewId,
                    );
                    return {
                        targetUserId: review.profileUserId,
                        sourceId: review.id,
                    };
                })
                .with(CommentSourceType.ACTIVITY, async () => {
                    const activity =
                        await this.activitiesRepositoryService.findOneByOrFail({
                            where: {
                                id: (comment as ActivityComment).activityId,
                            },
                        });
                    return {
                        targetUserId: activity.profileUserId,
                        sourceId: activity.id,
                    };
                })
                .with(CommentSourceType.POST, async () => {
                    const post = await this.postsService.findOneByIdOrFail(
                        (comment as PostComment).postId,
                    );
                    return {
                        targetUserId: post.profileUserId,
                        sourceId: post.id,
                    };
                })
                .exhaustive();
            targetUserId = targetInfo.targetUserId;
            sourceId = targetInfo.sourceId;
        }

        const notificationSourceType = match([comment.childOfId, sourceType])
            .returnType<NotificationSourceType>()
            .with(
                [P.nonNullable, CommentSourceType.REVIEW],
                () => NotificationSourceType.REVIEW_COMMENT,
            )
            .with(
                [P.nullish, CommentSourceType.REVIEW],
                () => NotificationSourceType.REVIEW,
            )
            .with(
                [P.nonNullable, CommentSourceType.POST],
                () => NotificationSourceType.POST_COMMENT,
            )
            .with(
                [P.nullish, CommentSourceType.POST],
                () => NotificationSourceType.POST,
            )
            .with(
                [P.nonNullable, CommentSourceType.ACTIVITY],
                () => NotificationSourceType.ACTIVITY_COMMENT,
            )
            .with(
                [P.nullish, CommentSourceType.ACTIVITY],
                () => NotificationSourceType.ACTIVITY,
            )
            .exhaustive();

        if (
            sourceId == undefined ||
            targetUserId == undefined ||
            notificationSourceType == undefined
        ) {
            this.logger.error(
                "Failed to generate comment notification: could not determine comment notification target.",
            );
            return;
        }

        this.notificationsQueueService.registerNotification({
            userId: comment.profileUserId,
            sourceId: sourceId,
            sourceType: notificationSourceType,
            targetUserId: targetUserId,
            category: ENotificationCategory.COMMENT,
        });
    }

    async update(userId: string, commentId: string, dto: UpdateCommentDto) {
        const targetRepository = this.getTargetRepository(dto.sourceType);

        await targetRepository.update(
            {
                profileUserId: userId,
                id: commentId,
            },
            {
                content: dto.content,
            },
        );
    }

    async delete(userId: string, commentId: string, dto: DeleteCommentDto) {
        const targetRepository = this.getTargetRepository(dto.sourceType);

        await targetRepository.delete({
            profileUserId: userId,
            id: commentId,
        });
    }
}
