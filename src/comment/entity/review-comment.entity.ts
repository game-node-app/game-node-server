import { UserComment } from "./user-comment.entity";
import { Column, Entity, Index, ManyToOne } from "typeorm";
import { Review } from "../../reviews/entities/review.entity";

@Entity()
@Index(["profile", "review"])
export class ReviewComment extends UserComment {
    @ManyToOne(() => Review, {
        nullable: false,
        onDelete: "CASCADE",
    })
    review: Review;
    @Column({
        nullable: false,
    })
    reviewId: string;
}
