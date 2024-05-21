import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from "typeorm";
import { UserView } from "./user-view.entity";
import { UserLike } from "./user-like.entity";
import { ReviewComment } from "../../comment/entity/review-comment.entity";

@Entity()
export class CommentStatistics extends Statistics {
    @OneToMany(() => UserView, (uv) => uv.commentStatistics)
    views: UserView[];
    @OneToMany(() => UserLike, (ul) => ul.commentStatistics)
    likes: UserLike[];
    @OneToOne(() => ReviewComment, {
        nullable: true,
    })
    @JoinColumn()
    reviewComment: ReviewComment;
    @Column({
        nullable: true,
    })
    reviewCommentId: string;
}
