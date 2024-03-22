import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from "typeorm";
import { UserView } from "./user-view.entity";
import { UserLike } from "./user-like.entity";
import { Review } from "../../reviews/entities/review.entity";

@Entity()
export class ReviewStatistics extends Statistics {
    @OneToMany(() => UserView, (uv) => uv.reviewStatistics)
    views: UserView[];
    @OneToMany(() => UserLike, (ul) => ul.reviewStatistics)
    likes: UserLike[];
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
