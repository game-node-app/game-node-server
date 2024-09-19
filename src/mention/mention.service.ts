import { Injectable } from "@nestjs/common";
import { Repository } from "typeorm";
import { ReviewMention } from "./entity/review-mention.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { MentionSource } from "./mention.constants";
import { toMap } from "../utils/toMap";

@Injectable()
export class MentionService {
    constructor(
        @InjectRepository(ReviewMention)
        private readonly reviewMentionRepository: Repository<ReviewMention>,
    ) {}

    /**
     * Changes the mentioned users for a given source.
     * This REPLACES mentions for a source entity.
     * @param source
     * @param sourceId
     * @param mentionedUserIds
     */
    public async setMentionsFor(
        source: MentionSource,
        sourceId: string,
        mentionedUserIds: string[],
    ) {
        const uniqueMentionedUserIds = Array.from(
            new Set(mentionedUserIds).values(),
        );
        switch (source) {
            case MentionSource.REVIEW:
                return this.setMentionsForReview(
                    sourceId,
                    uniqueMentionedUserIds,
                );

            // TODO: Implement mentions for comments

            default:
                throw new Error(`Mention source not supported: ${source}`);
        }
    }

    private async setMentionsForReview(
        reviewId: string,
        mentionedUserIds: string[],
    ) {
        await this.reviewMentionRepository.delete({
            reviewId,
        });

        for (const mentionedUserId of mentionedUserIds) {
            await this.reviewMentionRepository.save({
                reviewId,
                mentionedProfileUserId: mentionedUserId,
            });
        }
    }
}
