import { HttpException, HttpStatus, Injectable, Logger, Optional } from "@nestjs/common";
import { ReviewComment } from "./entity/review-comment.entity";
import { DataSource, IsNull, Repository } from "typeorm";
import { CreateCommentDto } from "./dto/create-comment.dto";
import {
    CommentSourceToStatisticsSource,
    CommentSourceType,
} from "./comment.constants";
import {
    deactivateStatisticsSource,
    createStatisticsTarget,
} from "../statistics/statistics-target.repository";
import { FindAllCommentsDto } from "./dto/find-all-comments.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { UpdateCommentDto } from "./dto/update-comment.dto";
import { DeleteCommentDto } from "./dto/delete-comment.dto";
import { BaseFindDto } from "../utils/base-find.dto";
import { UserComment } from "./entity/user-comment.entity";
import { ActivityComment } from "./entity/activity-comment.entity";
import { match } from "ts-pattern";
import { PostComment } from "./entity/post-comment.entity";
import { AnyComment } from "./comment.types";
import { Review } from "../reviews/entities/review.entity";
import { Post } from "../posts/entity/post.entity";
import { Activity } from "../activities/activities-repository/entities/activity.entity";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { NotificationsLifecycleService } from "../notifications/notifications-lifecycle.service";
import { AchievementsQueueService } from "../achievements/achievements-queue/achievements-queue.service";

@Injectable()
export class CommentService {
    private logger = new Logger(CommentService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly notificationsLifecycleService?: NotificationsLifecycleService,
        @Optional()
        private readonly achievementsQueueService?: AchievementsQueueService,
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
    ): Promise<TPaginationData<AnyComment>> {
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
    ): Promise<AnyComment | null> {
        const targetRepository = this.getTargetRepository(sourceType);
        return targetRepository.findOneBy({
            id: commentId,
        });
    }

    async findOneByIdOrFail(
        sourceType: CommentSourceType,
        commentId: string,
    ): Promise<AnyComment> {
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
    ): Promise<AnyComment[]> {
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

        const targetEntity = match<CommentSourceType, any>(sourceType)
            .with(CommentSourceType.REVIEW, () => ReviewComment)
            .with(CommentSourceType.ACTIVITY, () => ActivityComment)
            .with(CommentSourceType.POST, () => PostComment)
            .exhaustive();

        const targetRelationProperty =
            this.getTargetRelationIdProperty(sourceType);

        const rootType = match<
            CommentSourceType,
            "review" | "post" | "activity"
        >(sourceType)
            .with(CommentSourceType.REVIEW, () => "review")
            .with(CommentSourceType.ACTIVITY, () => "activity")
            .with(CommentSourceType.POST, () => "post")
            .exhaustive();

        const insertedEntry = await this.dataSource.transaction(
            async (manager) => {
                let rootOwnerId: string | null = null;
                if (sourceType === CommentSourceType.REVIEW) {
                    const review = await manager
                        .getRepository(Review)
                        .findOneBy({ id: sourceId });
                    if (!review) {
                        throw new HttpException(
                            "Target review not found",
                            HttpStatus.NOT_FOUND,
                        );
                    }
                    rootOwnerId = review.profileUserId;
                } else if (sourceType === CommentSourceType.POST) {
                    const post = await manager
                        .getRepository(Post)
                        .findOneBy({ id: sourceId });
                    if (!post) {
                        throw new HttpException(
                            "Target post not found",
                            HttpStatus.NOT_FOUND,
                        );
                    }
                    rootOwnerId = post.profileUserId;
                } else if (sourceType === CommentSourceType.ACTIVITY) {
                    const activity = await manager
                        .getRepository(Activity)
                        .findOneBy({ id: sourceId });
                    if (!activity) {
                        throw new HttpException(
                            "Target activity not found",
                            HttpStatus.NOT_FOUND,
                        );
                    }
                    rootOwnerId = activity.profileUserId;
                }

                let parentComment: AnyComment | null = null;
                if (childOf) {
                    parentComment =
                        (await manager
                            .getRepository<AnyComment>(targetEntity)
                            .findOneBy({ id: childOf } as any)) || null;
                    if (!parentComment) {
                        throw new HttpException(
                            "Parent comment not found",
                            HttpStatus.NOT_FOUND,
                        );
                    }
                    if (parentComment.childOfId != null) {
                        throw new HttpException(
                            "Deep-nested comments are not allowed. Comments must be a children of a single comment.",
                            HttpStatus.BAD_REQUEST,
                        );
                    }
                    const parentRootId = (parentComment as any)[
                        targetRelationProperty
                    ];
                    if (parentRootId !== sourceId) {
                        throw new HttpException(
                            "Parent comment belongs to a different root",
                            HttpStatus.BAD_REQUEST,
                        );
                    }
                }

                const commentRepo =
                    manager.getRepository<AnyComment>(targetEntity);
                const newComment = commentRepo.create({
                    profileUserId: userId,
                    content,
                    childOfId: childOf || null,
                    statisticsTargetId: await createStatisticsTarget(manager, CommentSourceToStatisticsSource[sourceType]),
                    [targetRelationProperty]: sourceId,
                } as any);
                const savedComment = (await commentRepo.save(
                    newComment as any,
                )) as AnyComment;

                if (childOf && parentComment) {
                    const recipientUserId = parentComment.profileUserId;
                    if (recipientUserId && recipientUserId !== userId) {
                        await appendNotificationIntent(manager, {
                            eventType: "comment.replied",
                            eventVersion: 1,
                            occurredAt: new Date(),
                            recipientUserId,
                            actorUserId: userId,
                            payload: {
                                commentId: savedComment.id,
                                parentCommentId: parentComment.id,
                                rootType,
                                rootId: sourceId,
                            },
                        });
                    }
                } else if (rootOwnerId && rootOwnerId !== userId) {
                    await appendNotificationIntent(manager, {
                        eventType: "comment.created",
                        eventVersion: 1,
                        occurredAt: new Date(),
                        recipientUserId: rootOwnerId,
                        actorUserId: userId,
                        payload: {
                            commentId: savedComment.id,
                            rootType,
                            rootId: sourceId,
                        },
                    });
                }

                return savedComment;
            },
        );

        this.achievementsQueueService?.addTrackingJob({
            userId,
            metric: "comments_written",
        });

        return insertedEntry;
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
        await this.dataSource.transaction(async (manager) => {
            const repository = manager.getRepository(targetRepository.target);
            const comment = await repository.findOne({
                where: { profileUserId: userId, id: commentId } as any,
                lock: { mode: "pessimistic_write" },
            });
            if (!comment) return;
            await deactivateStatisticsSource(
                manager,
                CommentSourceToStatisticsSource[dto.sourceType],
                commentId,
            );
            const result = await repository.delete({ profileUserId: userId, id: commentId } as any);
            if (result.affected) {
                await this.notificationsLifecycleService?.invalidateComment(
                    commentId,
                    manager,
                );
            }
        });
    }
}
