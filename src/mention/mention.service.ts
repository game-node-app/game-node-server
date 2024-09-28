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

@Injectable()
export class MentionService {
    constructor(
        @InjectRepository(ReviewMention)
        private readonly reviewMentionRepository: Repository<ReviewMention>,
        private readonly notificationsQueueService: NotificationsQueueService,
    ) {}

    /**
     * Changes the mentioned users for a given source.
     * This REPLACES mentions for a source entity.
     * @param userId
     * @param source
     * @param sourceId
     * @param mentionedUserIds
     */
    public async setMentionsFor(
        userId: string,
        source: MentionSource,
        sourceId: string,
        mentionedUserIds: string[],
    ) {
        const uniqueMentionedUserIds = Array.from(
            new Set(mentionedUserIds).values(),
            // Prevents self-mentioning
        ).filter((mentionedUserId) => mentionedUserId !== userId);
        switch (source) {
            case MentionSource.REVIEW:
                return this.setMentionsForReview(
                    userId,
                    sourceId,
                    uniqueMentionedUserIds,
                );

            // TODO: Implement mentions for comments

            default:
                throw new Error(`Mention source not supported: ${source}`);
        }
    }

    private async setMentionsForReview(
        userId: string,
        reviewId: string,
        mentionedUserIds: string[],
    ) {
        const mentions = await this.reviewMentionRepository.findBy({
            reviewId: reviewId,
        });

        const alreadyMentionedUserIds = mentionedUserIds.filter((userId) => {
            return mentions.some(
                (mention) => mention.mentionedProfileUserId === userId,
            );
        });

        await this.reviewMentionRepository.delete({
            reviewId,
            // Excludes users that are being re-mentioned to avoid sending duplicate notifications.
            mentionedProfileUserId: Not(In(alreadyMentionedUserIds)),
        });

        for (const mentionedUserId of mentionedUserIds) {
            if (alreadyMentionedUserIds.includes(mentionedUserId)) {
                continue;
            }

            await this.reviewMentionRepository.save({
                reviewId,
                mentionedProfileUserId: mentionedUserId,
            });
            // Sends a mention notification to the target user
            this.notificationsQueueService.registerNotification({
                sourceId: reviewId,
                targetUserId: mentionedUserId,
                userId: userId,
                category: ENotificationCategory.MENTION,
                sourceType: ENotificationSourceType.REVIEW,
            });
        }
    }
}
