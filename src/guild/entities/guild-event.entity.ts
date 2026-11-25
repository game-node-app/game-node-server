import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import {
    GuildBonusObjective,
    GuildCriteria,
    GuildEventStatus,
    GuildObjectiveType,
    GuildRank,
} from "../guild.constants";
import { GuildEventTranslation } from "./guild-event-translation.entity";
import { GuildReward } from "./guild-reward.entity";

/** An editor-curated seasonal/editorial Guild event (design 1). */
@Entity()
@Unique("UQ_guild_event_slug", ["slug"])
@Index("IDX_guild_event_status_window", ["status", "startsAt", "endsAt"])
export class GuildEvent {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @Column({ type: "varchar", length: 64 })
    slug: string;

    @Column({ type: "varchar", length: 120 })
    title: string;

    @Column({ type: "varchar", length: 500 })
    description: string;

    @Column({ type: "varchar", length: 4 })
    rank: GuildRank;

    @Column({ type: "int", unsigned: true })
    xpReward: number;

    @Column({ type: "int", unsigned: true, default: 0 })
    sealsReward: number;

    @Column({ type: "varchar", length: 32 })
    objectiveType: GuildObjectiveType;

    @Column({ type: "int", unsigned: true, default: 1 })
    targetCount: number;

    @Column({ type: "json" })
    criteria: GuildCriteria;

    @Column({ type: "json", nullable: true, default: null })
    bonusObjective: GuildBonusObjective | null;

    @ManyToOne(() => GuildReward, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "rewardId",
        foreignKeyConstraintName: "FK_guild_event_reward",
    })
    reward: GuildReward | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    rewardId: string | null;

    @Column({ type: "datetime" })
    startsAt: Date;

    @Column({ type: "datetime" })
    endsAt: Date;

    @Column({ type: "varchar", length: 16, default: GuildEventStatus.DRAFT })
    status: GuildEventStatus;

    @Column({ type: "datetime", nullable: true, default: null })
    publishedAt: Date | null;

    @OneToMany(() => GuildEventTranslation, (translation) => translation.event)
    translations: GuildEventTranslation[];

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
