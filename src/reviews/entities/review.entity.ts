import {
    Column,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { ReviewStatistics } from "../../statistics/entity/review-statistics.entity";

@Entity()
export class Review {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    @Column({ nullable: false })
    userId: string;
    @OneToOne(
        () => ReviewStatistics,
        (reviewStatistics) => reviewStatistics.review,
    )
    @JoinColumn()
    reviewStatistics: ReviewStatistics;
}
