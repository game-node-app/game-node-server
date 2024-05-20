import { UserComment } from "./user-comment.entity";
import { Column, Entity, ManyToOne } from "typeorm";
import { Review } from "../../reviews/entities/review.entity";

@Entity()
export class ReviewComment extends UserComment {
    @ManyToOne(() => Review, {
        nullable: false,
    })
    review: Review;
    @Column({
        nullable: false,
    })
    reviewId: string;
}
