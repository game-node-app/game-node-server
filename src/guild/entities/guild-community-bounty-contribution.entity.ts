import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { GuildCommunityBounty } from "./guild-community-bounty.entity";

/** A deduplicated qualifying action counting toward a bounty (design 1). */
@Entity()
@Unique("UQ_guild_bounty_contribution_bounty_user_source", [
    "bountyId",
    "profileUserId",
    "sourceKey",
])
@Index("IDX_guild_bounty_contrib_user", ["bountyId", "profileUserId"])
export class GuildCommunityBountyContribution {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @ManyToOne(() => GuildCommunityBounty, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn({
        name: "bountyId",
        foreignKeyConstraintName: "FK_guild_bounty_contribution_bounty",
    })
    bounty: GuildCommunityBounty;

    @Column({ type: "varchar", length: 36 })
    bountyId: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_bounty_contribution_profile",
    })
    profile: Profile;

    @Column({ type: "varchar", length: 36 })
    profileUserId: string;

    /** Stable action identity, for example `game:1029` or `post:<uuid>`. */
    @Column({ type: "varchar", length: 128 })
    sourceKey: string;

    @Column({ type: "int", unsigned: true, default: 1 })
    units: number;

    @Column({ type: "datetime", precision: 6 })
    contributedAt: Date;
}
