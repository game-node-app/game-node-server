import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    Unique,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import {
    GuildBoardCycle,
    GuildBonusObjective,
    GuildCategory,
    GuildCriteria,
    GuildObjectiveType,
    GuildRank,
} from "../guild.constants";
import { GuildReward } from "./guild-reward.entity";

/** A candidate chip on a board quest, with the data the client renders. */
export interface GuildBoardCandidateGame {
    gameId: number;
    sinceYear?: number;
    estimatedHours?: number;
}

/**
 * One persisted non-event quest of a user's weekly board or Monthly Expedition.
 * UNIQUE (profileUserId, cycle, periodKey, slotIndex) makes same-period generation idempotent.
 * `weekStart` stays the first day of the period for backwards compatibility.
 */
@Entity()
@Unique("UQ_guild_board_entry_user_cycle_period_slot", [
    "profileUserId",
    "cycle",
    "periodKey",
    "slotIndex",
])
export class GuildBoardEntry {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_board_entry_profile",
    })
    profile: Profile;

    @Column({ type: "varchar", length: 36 })
    profileUserId: string;

    /** Monday of the board week, "YYYY-MM-DD" in São Paulo. */
    @Column({ type: "date" })
    weekStart: string;

    /** "weekly" or "monthly"; Monthly Expeditions keep weekStart as the 1st. */
    @Column({ type: "varchar", length: 16, default: GuildBoardCycle.WEEKLY })
    cycle: GuildBoardCycle;

    /** "YYYY-MM-DD" for weekly boards, "YYYY-MM" for monthly expeditions. */
    @Column({ type: "varchar", length: 10, nullable: true, default: null })
    periodKey: string | null;

    @Column({ type: "tinyint", unsigned: true })
    slotIndex: number;

    @Column({ type: "varchar", length: 16 })
    category: GuildCategory;

    @Column({ type: "varchar", length: 64 })
    templateKey: string;

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

    /** Procedural display params: genreName, franchiseName, decade, staleDays. */
    @Column({ type: "json", nullable: true, default: null })
    meta: Record<string, unknown> | null;

    @Column({ type: "tinyint", unsigned: true, default: 0 })
    rerollCount: number;

    @Column({ type: "json" })
    candidateGames: GuildBoardCandidateGame[];

    @Column({ type: "boolean", default: false })
    requiresTargetGame: boolean;

    @ManyToOne(() => GuildReward, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "rewardId",
        foreignKeyConstraintName: "FK_guild_board_entry_reward",
    })
    reward: GuildReward | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    rewardId: string | null;

    @Column({ type: "boolean", default: false })
    isRecommended: boolean;

    @Column({ type: "boolean", default: false })
    isQuick: boolean;

    @Column({ type: "datetime" })
    expiresAt: Date;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;
}
