import { Injectable } from "@nestjs/common";
import { In, Not, Repository } from "typeorm";
import { ReviewMention } from "./entity/review-mention.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { MentionSource } from "./mention.constants";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";
import { CommentMention } from "./entity/comment-mention.entity";
import { CommentSourceType } from "../comment/comment.constants";

@Injectable()
export class MentionService {
    constructor(
        @InjectRepository(ReviewMention)
        private readonly reviewMentionRepository: Repository<ReviewMention>,
        @InjectRepository(CommentMention)
        private readonly commentMentionRepository: Repository<CommentMention>,
        private readonly notificationsQueueService: NotificationsQueueService,
    ) {}

    public async setMentionsForReview(
        userId: string,
        reviewId: string,
        mentionedUserIds: string[],
    ) {
        const uniqueMentionedUserIds = Array.from(
            new Set(mentionedUserIds).values(),
            // Prevents self-mentioning
        ).filter((mentionedUserId) => mentionedUserId !== userId);

        const mentions = await this.reviewMentionRepository.findBy({
            reviewId: reviewId,
        });

        const alreadyMentionedUserIds = uniqueMentionedUserIds.filter(
            (userId) => {
                return mentions.some(
                    (mention) => mention.mentionedProfileUserId === userId,
                );
            },
        );

        await this.reviewMentionRepository.delete({
            reviewId,
            // Excludes users that are being re-mentioned to avoid sending duplicate notifications.
            mentionedProfileUserId: Not(In(alreadyMentionedUserIds)),
        });

        for (const mentionedUserId of uniqueMentionedUserIds) {
            if (alreadyMentionedUserIds.includes(mentionedUserId)) {
                continue;
            }

            await this.reviewMentionRepository.save({
                reviewId,
                mentionedProfileUserId: mentionedUserId,
            });

            // TODO: Send notification to the target user
        }
    }

    private async setMentionsForComment(
        userId: string,
        commentSource: CommentSourceType,
        commentId: string,
        mentionedUserIds: string[],
    ) {
        let targetRelationProperty: keyof CommentMention;

        switch (commentSource) {
            case CommentSourceType.REVIEW:
                targetRelationProperty = "reviewCommentId";
                break;
            default:
                targetRelationProperty = "reviewCommentId";
        }

        const uniqueMentionedUserIds = Array.from(
            new Set(mentionedUserIds).values(),
            // Prevents self-mentioning
        ).filter((mentionedUserId) => mentionedUserId !== userId);

        const mentions = await this.commentMentionRepository.findBy({
            [targetRelationProperty]: commentId,
        });

        const alreadyMentionedUserIds = uniqueMentionedUserIds.filter(
            (userId) => {
                return mentions.some(
                    (mention) => mention.mentionedProfileUserId === userId,
                );
            },
        );

        await this.commentMentionRepository.delete({
            [targetRelationProperty]: commentId,
            // Excludes users that are being re-mentioned to avoid sending duplicate notifications.
            mentionedProfileUserId: Not(In(alreadyMentionedUserIds)),
        });

        for (const mentionedUserId of uniqueMentionedUserIds) {
            if (alreadyMentionedUserIds.includes(mentionedUserId)) {
                continue;
            }

            await this.reviewMentionRepository.save({
                [targetRelationProperty]: commentId,
                mentionedProfileUserId: mentionedUserId,
            });
        }
    }
}
