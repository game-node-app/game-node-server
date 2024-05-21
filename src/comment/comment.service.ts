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

const MIN_COMMENT_CREATE_WAIT_TIME = minutes(1);

@Injectable()
export class CommentService {
    constructor(
        @InjectRepository(ReviewComment)
        private readonly reviewCommentRepository: Repository<ReviewComment>,
        private readonly statisticsQueueService: StatisticsQueueService,
    ) {}

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
}
