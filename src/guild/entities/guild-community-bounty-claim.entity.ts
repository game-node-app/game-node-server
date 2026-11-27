import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { GuildCommunityBounty } from "./guild-community-bounty.entity";

/** One member's claimed milestones and ready-notification marker (design 1). */
@Entity()
export class GuildCommunityBountyClaim {
    @PrimaryColumn({ type: "varchar", length: 36 })
    bountyId: string;

    @ManyToOne(() => GuildCommunityBounty, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn({
        name: "bountyId",
        foreignKeyConstraintName: "FK_guild_bounty_claim_bounty",
    })
    bounty: GuildCommunityBounty;

    @PrimaryColumn({ type: "varchar", length: 36 })
    profileUserId: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_bounty_claim_profile",
    })
    profile: Profile;

    @Column({ type: "json" })
    claimedMilestones: number[];

    @Column({ type: "datetime", precision: 6, nullable: true, default: null })
    notifiedReadyAt: Date | null;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
