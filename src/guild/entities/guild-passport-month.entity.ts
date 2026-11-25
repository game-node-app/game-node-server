import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";

/** Monthly Guild Passport stamp count and claimed milestones (design 1). */
@Entity()
export class GuildPassportMonth {
    @PrimaryColumn({ type: "varchar", length: 36 })
    profileUserId: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_passport_month_profile",
    })
    profile: Profile;

    /** "YYYY-MM" São Paulo month. */
    @PrimaryColumn({ type: "char", length: 7 })
    monthKey: string;

    @Column({ type: "int", unsigned: true, default: 0 })
    completedContractsCount: number;

    @Column({ type: "json" })
    claimedMilestones: number[];

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
