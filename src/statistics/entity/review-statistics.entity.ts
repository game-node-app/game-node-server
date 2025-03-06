import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToOne } from "typeorm";
import { Review } from "../../reviews/entities/review.entity";

@Entity()
export class ReviewStatistics extends Statistics {
    @OneToOne(() => Review, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    review: Review;
    @Column({
        nullable: false,
    })
    reviewId: string;
}
