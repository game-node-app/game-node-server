import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ReviewComment } from "./entity/review-comment.entity";
import { Repository } from "typeorm";
import { CreateCommentDto } from "./dto/create-comment.dto";
import { CommentSourceType } from "./comment.constants";
import { UserComment } from "./entity/user-comment.entity";
import { minutes } from "@nestjs/throttler";
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

const MIN_COMMENT_CREATE_WAIT_TIME = minutes(1);

@Injectable()
export class CommentService {
    private logger = new Logger(CommentService.name);

    constructor(
        @InjectRepository(ReviewComment)
        private readonly reviewCommentRepository: Repository<ReviewComment>,
        private readonly statisticsQueueService: StatisticsQueueService,
        private readonly notificationsQueueService: NotificationsQueueService,
        private readonly reviewsService: ReviewsService,
    ) {}

    private getTargetRepository(commentSourceType: CommentSourceType) {
        switch (commentSourceType) {
            case CommentSourceType.REVIEW:
                return this.reviewCommentRepository;
        }
    }

    async findAll(
        dto: FindAllCommentsDto,
    ): Promise<TPaginationData<ReviewComment>> {
        const baseFindOptions = buildBaseFindOptions(dto);
        let items: any[];
        let total = 0;
        switch (dto.sourceType) {
            case CommentSourceType.REVIEW:
                [items, total] =
                    await this.reviewCommentRepository.findAndCount({
                        ...baseFindOptions,
                        where: {
                            reviewId: dto.sourceId,
                        },
                    });
                break;
            default:
                throw new HttpException(
                    "Invalid source type for comment",
                    HttpStatus.BAD_REQUEST,
                );
        }

        if (total === 0) {
            throw new HttpException(
                "No comments found for given criteria.",
                HttpStatus.NOT_FOUND,
            );
        }

        return [items, total];
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

    private async checkForCreateSpam(userId: string, dto: CreateCommentDto) {
        let targetComment: UserComment | null = null;
        switch (dto.sourceType) {
            case CommentSourceType.REVIEW:
                targetComment = await this.reviewCommentRepository.findOneBy({
                    profileUserId: userId,
                    reviewId: dto.sourceId,
                });
                break;
        }

        if (targetComment != undefined) {
            const now = new Date().getTime();
            const createdTime = targetComment.createdAt.getTime();
            if (now - createdTime < MIN_COMMENT_CREATE_WAIT_TIME) {
                throw new HttpException(
                    "Please wait at least one minute before sending a new comment.",
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
        }
    }

    async create(userId: string, dto: CreateCommentDto) {
        const { sourceType, sourceId, content } = dto;

        await this.checkForCreateSpam(userId, dto);

        let insertedEntryId: string;
        switch (sourceType) {
            case CommentSourceType.REVIEW:
                const insertedEntry = await this.reviewCommentRepository.save({
                    profileUserId: userId,
                    reviewId: sourceId,
                    content,
                });
                insertedEntryId = insertedEntry.id;
                break;
            default:
                throw new HttpException(
                    "Invalid sourceType.",
                    HttpStatus.BAD_REQUEST,
                );
        }

        this.statisticsQueueService.createStatistics({
            sourceType: StatisticsSourceType.REVIEW_COMMENT,
            sourceId: insertedEntryId,
        });

        this.createNotification(insertedEntryId, sourceType)
            .then()
            .catch((err) => {
                this.logger.error(err);
            });
    }

    /**
     * Registers notification for target entity (e.g. review) when a new comment is inserted.
     * @param commentId
     * @param sourceType
     */
    async createNotification(commentId: string, sourceType: CommentSourceType) {
        const comment = await this.findOneByIdOrFail(sourceType, commentId);
        let targetUserId: string;
        let sourceId: string;
        switch (sourceType) {
            case CommentSourceType.REVIEW:
                const review = await this.reviewsService.findOneByIdOrFail(
                    comment.reviewId,
                );
                targetUserId = review.profileUserId;
                sourceId = review.id;
                break;
        }

        this.notificationsQueueService.registerNotification({
            userId: comment.profileUserId,
            sourceId: sourceId,
            sourceType: ENotificationSourceType.REVIEW,
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
