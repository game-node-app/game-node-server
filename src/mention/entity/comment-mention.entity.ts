import { Column, Entity, ManyToOne, Unique } from "typeorm";
import { BaseMentionEntity } from "./mention.entity";
import { ReviewComment } from "../../comment/entity/review-comment.entity";

@Entity()
@Unique(["mentionedProfile", "reviewComment"])
export class CommentMention extends BaseMentionEntity {
    @ManyToOne(() => ReviewComment, {
        nullable: false,
    })
    reviewComment: ReviewComment;
    @Column()
    reviewCommentId: string;
}
