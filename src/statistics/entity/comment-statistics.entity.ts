import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToOne } from "typeorm";
import { ReviewComment } from "../../comment/entity/review-comment.entity";
import { ActivityComment } from "../../comment/entity/activity-comment.entity";
import { PostComment } from "../../comment/entity/post-comment.entity";

@Entity()
export class CommentStatistics extends Statistics {
    @OneToOne(() => ReviewComment, {
        nullable: true,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    reviewComment: ReviewComment | null;
    @Column({
        nullable: true,
    })
    reviewCommentId: string | null;
    @OneToOne(() => ActivityComment, {
        nullable: true,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    activityComment: ActivityComment | null;
    @Column({
        nullable: true,
    })
    activityCommentId: string | null;
    @OneToOne(() => PostComment, {
        nullable: true,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    postComment: PostComment | null;
    @Column({
        nullable: true,
    })
    postCommentId: string | null;
}
