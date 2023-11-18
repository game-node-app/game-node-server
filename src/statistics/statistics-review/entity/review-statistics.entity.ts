import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    OneToOne,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { UserLike } from "../../entity/user-like.entity";
import { Review } from "../../../reviews/entities/review.entity";

@Entity()
export class ReviewStatistics {
    @PrimaryGeneratedColumn()
    id: number;
    @OneToOne(() => Review, (review) => review.reviewStatistics, {
        nullable: false,
    })
    review: Review;
    @Column({
        nullable: false,
        default: 0,
    })
    likesCount: number;
    @OneToMany(() => UserLike, (userLike) => userLike.reviewStatistics)
    likes: UserLike[];
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
