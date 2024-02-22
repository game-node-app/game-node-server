import { Statistics } from "./statistics.entity";
import { Review } from "../../reviews/entities/review.entity";
import { Column, JoinColumn, OneToOne } from "typeorm";

export class ReviewStatistics extends Statistics {
    @OneToOne(() => Review, {
        nullable: false,
    })
    @JoinColumn({
        name: "sourceId",
    })
    source: Review;
    @Column()
    sourceId: string;
}
