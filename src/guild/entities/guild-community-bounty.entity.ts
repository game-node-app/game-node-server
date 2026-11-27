import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    OneToMany,
    PrimaryColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import {
    GuildBountyStatus,
    GuildCriteria,
    GuildObjectiveType,
} from "../guild.constants";
import { GuildCommunityBountyTranslation } from "./guild-community-bounty-translation.entity";

/** A server-wide cooperative campaign with shared milestones (design 1). */
@Entity()
@Unique("UQ_guild_community_bounty_slug", ["slug"])
@Index("IDX_guild_bounty_status_window", ["status", "startsAt", "endsAt"])
export class GuildCommunityBounty {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @Column({ type: "varchar", length: 64 })
    slug: string;

    @Column({ type: "varchar", length: 120 })
    title: string;

    @Column({ type: "varchar", length: 500 })
    description: string;

    @Column({ type: "varchar", length: 32 })
    objectiveType: GuildObjectiveType;

    @Column({ type: "json" })
    criteria: GuildCriteria;

    @Column({ type: "int", unsigned: true })
    targetTotal: number;

    @Column({ type: "int", unsigned: true, default: 0 })
    currentTotal: number;

    @Column({ type: "int", unsigned: true, default: 1 })
    minUserContribution: number;

    @Column({ type: "int", unsigned: true })
    maxUserContributionCap: number;

    /** `{ "25": {...}, "50": {...}, "100": {...}, "150": {...} }` */
    @Column({ type: "json" })
    milestoneRewards: Record<string, unknown>;

    @Column({ type: "datetime" })
    startsAt: Date;

    @Column({ type: "datetime" })
    endsAt: Date;

    @Column({ type: "varchar", length: 16, default: GuildBountyStatus.DRAFT })
    status: GuildBountyStatus;

    @Column({ type: "datetime", nullable: true, default: null })
    publishedAt: Date | null;

    @Column({ type: "datetime", precision: 6, nullable: true, default: null })
    reached100At: Date | null;

    @OneToMany(
        () => GuildCommunityBountyTranslation,
        (translation) => translation.bounty,
    )
    translations: GuildCommunityBountyTranslation[];

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
