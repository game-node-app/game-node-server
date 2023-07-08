import {
    CreateDateColumn,
    Entity,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { UserLike } from "./user-like.entity";
import { Review } from "../../reviews/entities/review.entity";

@Entity()
export class ReviewStatistics {
    @PrimaryGeneratedColumn()
    id: number;
    @OneToOne(() => Review, (review) => review.reviewStatistics, {
        nullable: false,
    })
    review: Review;
    @OneToMany(() => UserLike, (userLike) => userLike.reviewStatistics)
    likes: UserLike[];
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
