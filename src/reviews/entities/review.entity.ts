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
    @Column({ nullable: false })
    igdbId: number;
    @Column({ nullable: false })
    title: string;
    @Column({ nullable: false, type: "longtext" })
    content: string;
    @Column({ nullable: false })
    rating: number;
    @OneToOne(
        () => ReviewStatistics,
        (reviewStatistics) => reviewStatistics.review,
    )
    @JoinColumn()
    reviewStatistics: ReviewStatistics;
}
