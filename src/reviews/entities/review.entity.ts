import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { ReviewStatistics } from "../../statistics/entity/review-statistics.entity";
import { Profile } from "../../profile/entities/profile.entity";

@Entity()
export class Review {
    @PrimaryGeneratedColumn("uuid")
    id: string;
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
    @ManyToOne(() => Profile)
    profile: Profile;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
