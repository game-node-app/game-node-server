import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Review } from "../../reviews/entities/review.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { ReportCategory, ReportSourceType } from "../report.constants";

@Entity()
export class Report {
    @PrimaryGeneratedColumn()
    id: number;

    /**
     * Indexed to improve speed when filtering by type.
     */
    @Column({
        nullable: false,
    })
    @Index()
    sourceType: ReportSourceType;

    @Column({
        nullable: false,
    })
    category: ReportCategory;

    // Relations
    @ManyToOne(() => Review, {
        nullable: true,
    })
    targetReview: Review | null;
    @Column({
        nullable: true,
    })
    targetReviewId: string | null;
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    targetProfile: Profile;
    @Column({
        nullable: false,
    })
    targetProfileUserId: string;

    /**
     * User-submitted reason for report.
     */
    @Column({
        type: "longtext",
        nullable: true,
    })
    reason: string | null;
    /**
     * User responsible for report.
     */
    @ManyToOne(() => Profile, {
        nullable: false,
    })
    profile: Profile;
    @Column()
    profileUserId: string;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
