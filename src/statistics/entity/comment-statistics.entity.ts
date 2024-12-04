import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from "typeorm";
import { UserView } from "./user-view.entity";
import { UserLike } from "./user-like.entity";
import { ReviewComment } from "../../comment/entity/review-comment.entity";
import { ActivityComment } from "../../comment/entity/activity-comment.entity";

@Entity()
export class CommentStatistics extends Statistics {
    @OneToMany(() => UserView, (uv) => uv.commentStatistics)
    views: UserView[];
    @OneToMany(() => UserLike, (ul) => ul.commentStatistics)
    likes: UserLike[];
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
}
