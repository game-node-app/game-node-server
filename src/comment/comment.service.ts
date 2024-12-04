import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ReviewComment } from "./entity/review-comment.entity";
import { IsNull, Repository } from "typeorm";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { CommentSourceType } from "./comment.constants";
import { StatisticsQueueService } from "../statistics/statistics-queue/statistics-queue.service";
import { StatisticsSourceType } from "../statistics/statistics.constants";
import { FindAllCommentsDto } from "./dto/find-all-comments.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { DeleteCommentDto } from "./dto/delete-comment.dto";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import { ReviewsService } from "../reviews/reviews.service";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";
import { BaseFindDto } from "../utils/base-find.dto";
import { UserComment } from "./entity/user-comment.entity";
import { ActivityComment } from "./entity/activity-comment.entity";
import { ActivitiesRepositoryService } from "../activities/activities-repository/activities-repository.service";

@Injectable()
export class CommentService {
    private logger = new Logger(CommentService.name);

    constructor(
        @InjectRepository(ReviewComment)
        private readonly reviewCommentRepository: Repository<ReviewComment>,
        @InjectRepository(ActivityComment)
        private readonly activityCommentRepository: Repository<ActivityComment>,
        private readonly statisticsQueueService: StatisticsQueueService,
        private readonly notificationsQueueService: NotificationsQueueService,
        private readonly reviewsService: ReviewsService,
        private readonly activitiesRepositoryService: ActivitiesRepositoryService,
    ) {}

    private getTargetRepository(commentSourceType: CommentSourceType) {
        switch (commentSourceType) {
            case CommentSourceType.REVIEW:
                return this.reviewCommentRepository;
            case CommentSourceType.ACTIVITY:
                return this.activityCommentRepository;
        }
    }

    async findAll(
        dto: FindAllCommentsDto,
    ): Promise<TPaginationData<ReviewComment | ActivityComment>> {
        const baseFindOptions = buildBaseFindOptions(dto);
        switch (dto.sourceType) {
            case CommentSourceType.REVIEW:
                return await this.reviewCommentRepository.findAndCount({
                    ...baseFindOptions,
                    where: {
                        reviewId: dto.sourceId,
                        // Only returns top-level comments, excluding comments of comments in the main list
                        childOfId: IsNull(),
                    },
                    relations: {
                        // Includes comments of comments in a list in each element
                        childOf: true,
                    },
                });
            case CommentSourceType.ACTIVITY:
                return await this.activityCommentRepository.findAndCount({
                    ...baseFindOptions,
                    where: {
                        activityId: dto.sourceId,
                        // Only returns top-level comments, excluding comments of comments in the main list
                        childOfId: IsNull(),
                    },
                    relations: {
                        // Includes comments of comments in a list in each element
                        childOf: true,
                    },
                });
            default:
                throw new HttpException(
                    "Invalid source type for comment",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }

    async findOneById(sourceType: CommentSourceType, commentId: string) {
        const targetRepository = this.getTargetRepository(sourceType);
        return targetRepository.findOneBy({
            id: commentId,
        });
    }

    async findOneByIdOrFail(sourceType: CommentSourceType, commentId: string) {
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
    ) {
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

        switch (sourceType) {
            case CommentSourceType.REVIEW: {
                const insertedEntry = await this.reviewCommentRepository.save({
                    profileUserId: userId,
                    reviewId: sourceId,
                    content,
                    childOfId: childOf,
                });

                this.statisticsQueueService.createStatistics({
                    sourceType: StatisticsSourceType.ACTIVITY_COMMENT,
                    sourceId: insertedEntry.id,
                });

                this.createNotification(
                    insertedEntry.id,
                    CommentSourceType.REVIEW,
                )
                    .then()
                    .catch((err) => {
                        this.logger.error(err);
                    });

                break;
            }
            case CommentSourceType.ACTIVITY: {
                const insertedEntry = await this.activityCommentRepository.save(
                    {
                        profileUserId: userId,
                        activityId: sourceId,
                        content,
                        childOfId: childOf,
                    },
                );

                this.statisticsQueueService.createStatistics({
                    sourceType: StatisticsSourceType.ACTIVITY_COMMENT,
                    sourceId: insertedEntry.id,
                });

                this.createNotification(
                    insertedEntry.id,
                    CommentSourceType.ACTIVITY,
                )
                    .then()
                    .catch((err) => {
                        this.logger.error(err);
                    });

                break;
            }
            default:
                throw new HttpException(
                    "Invalid sourceType.",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }

    /**
     * Registers notification for target entity (e.g. review, review comment) when a new comment is inserted.
     * @param commentId
     * @param sourceType
     */
    async createNotification(commentId: string, sourceType: CommentSourceType) {
        const comment = await this.findOneByIdOrFail(sourceType, commentId);

        let targetUserId: string | undefined;
        let sourceId: string | undefined;
        let notificationSourceType: ENotificationSourceType | undefined;

        if (comment instanceof ReviewComment) {
            if (comment.childOfId != undefined) {
                const parentComment = await this.findOneByIdOrFail(
                    sourceType,
                    comment.childOfId,
                );
                targetUserId = parentComment.profileUserId;
                sourceId = parentComment.id;
                notificationSourceType = ENotificationSourceType.REVIEW_COMMENT;
            } else {
                const review = await this.reviewsService.findOneByIdOrFail(
                    comment.reviewId,
                );
                targetUserId = review.profileUserId;
                sourceId = review.id;
                notificationSourceType = ENotificationSourceType.REVIEW;
            }
        } else if (comment instanceof ActivityComment) {
            if (comment.childOfId != undefined) {
                const parentComment = await this.findOneByIdOrFail(
                    sourceType,
                    comment.childOfId,
                );
                targetUserId = parentComment.profileUserId;
                sourceId = parentComment.id;
                notificationSourceType =
                    ENotificationSourceType.ACTIVITY_COMMENT;
            } else {
                const activity =
                    await this.activitiesRepositoryService.findOneByOrFail({
                        where: {
                            id: comment.activityId,
                        },
                    });
                targetUserId = activity.profileUserId;
                sourceId = activity.id;
                notificationSourceType = ENotificationSourceType.ACTIVITY;
            }
        }

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
