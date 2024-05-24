import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
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

const MIN_COMMENT_CREATE_WAIT_TIME = minutes(1);

@Injectable()
export class CommentService {
    constructor(
        @InjectRepository(ReviewComment)
        private readonly reviewCommentRepository: Repository<ReviewComment>,
        private readonly statisticsQueueService: StatisticsQueueService,
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
}
