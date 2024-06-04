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
import { ReportSourceType } from "../report.constants";

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

    // Relations
    @ManyToOne(() => Review, {
        nullable: true,
    })
    targetReview: Review | null;
    @Column({
        nullable: true,
    })
    targetReviewId: string | null;
    /**
     * Should only be filled when sourceType equals 'profile'!
     */
    @ManyToOne(() => Profile, {
        nullable: true,
    })
    targetProfile: Profile | null;
    @Column({
        nullable: true,
    })
    targetProfileUserId: string | null;

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
