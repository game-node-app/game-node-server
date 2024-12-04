import { UserComment } from "./user-comment.entity";
import { Column, Entity, Index, ManyToOne, OneToMany } from "typeorm";
import { Review } from "../../reviews/entities/review.entity";
import { ThreadEnabledComment } from "../comment.types";

@Entity()
@Index(["profile", "review"])
export class ReviewComment
    extends UserComment
    implements ThreadEnabledComment<ReviewComment>
{
    @ManyToOne(() => Review, {
        nullable: false,
        onDelete: "CASCADE",
    })
    review: Review;
    @Column({
        nullable: false,
    })
    reviewId: string;

    @OneToMany(() => ReviewComment, (comment) => comment.childOf)
    parentOf: ReviewComment[] | null;

    @ManyToOne(() => ReviewComment, {
        nullable: true,
        onDelete: "CASCADE",
    })
    childOf: ReviewComment[] | null;
    @Column({
        nullable: true,
    })
    childOfId: string | null;
}
