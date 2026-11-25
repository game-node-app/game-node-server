import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Profile } from "../../profile/entities/profile.entity";
import {
    GuildBonusObjective,
    GuildCategory,
    GuildContractStatus,
    GuildCriteria,
    GuildObjectiveType,
    GuildRank,
} from "../guild.constants";
import { GuildBoardEntry } from "./guild-board-entry.entity";
import { GuildEvent } from "./guild-event.entity";
import { GuildReward } from "./guild-reward.entity";
import { GuildUserChain } from "./guild-user-chain.entity";

/** An accepted quest tracked through active -> ready_to_claim -> completed (design 1). */
@Entity()
@Index("IDX_guild_contract_user_status", [
    "profileUserId",
    "status",
    "updatedAt",
])
@Index("IDX_guild_contract_user_board", ["profileUserId", "boardEntryId"])
@Index("IDX_guild_contract_user_event", ["profileUserId", "eventId"])
@Index("IDX_guild_contract_status_expires", ["status", "expiresAt"])
@Index("IDX_guild_contract_chain_progress", ["chainProgressId"])
export class GuildContract {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_contract_profile",
    })
    profile: Profile;

    @Column({ type: "varchar", length: 36 })
    profileUserId: string;

    @ManyToOne(() => GuildBoardEntry, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "boardEntryId",
        foreignKeyConstraintName: "FK_guild_contract_board_entry",
    })
    boardEntry: GuildBoardEntry | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    boardEntryId: string | null;

    @ManyToOne(() => GuildEvent, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "eventId",
        foreignKeyConstraintName: "FK_guild_contract_event",
    })
    event: GuildEvent | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    eventId: string | null;

    @Column({ type: "varchar", length: 16 })
    category: GuildCategory;

    @Column({ type: "varchar", length: 64, nullable: true, default: null })
    templateKey: string | null;

    @Column({ type: "varchar", length: 4 })
    rank: GuildRank;

    @Column({ type: "int", unsigned: true })
    xpReward: number;

    @Column({ type: "int", unsigned: true, default: 0 })
    sealsReward: number;

    @Column({ type: "varchar", length: 32 })
    objectiveType: GuildObjectiveType;

    @Column({ type: "json" })
    criteria: GuildCriteria;

    /** Optional secondary objective, snapshotted on accept; locked after (design 4). */
    @Column({ type: "json", nullable: true, default: null })
    bonusObjective: GuildBonusObjective | null;

    @Column({ type: "boolean", default: false })
    bonusCompleted: boolean;

    /** Hourglass extensions applied; at most 1 per contract (spec: contracts). */
    @Column({ type: "tinyint", unsigned: true, default: 0 })
    extendedCount: number;

    @ManyToOne(() => GuildUserChain, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "chainProgressId",
        foreignKeyConstraintName: "FK_guild_contract_chain_progress",
    })
    chainProgress: GuildUserChain | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    chainProgressId: string | null;

    @ManyToOne(() => Game, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "targetGameId",
        foreignKeyConstraintName: "FK_guild_contract_game",
    })
    targetGame: Game | null;

    @Column({ type: "bigint", nullable: true, default: null })
    targetGameId: number | null;

    @Column({ type: "int", unsigned: true, default: 0 })
    progressCurrent: number;

    @Column({ type: "int", unsigned: true, default: 1 })
    progressTarget: number;

    @Column({
        type: "varchar",
        length: 20,
        default: GuildContractStatus.ACTIVE,
    })
    status: GuildContractStatus;

    @ManyToOne(() => GuildReward, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "rewardId",
        foreignKeyConstraintName: "FK_guild_contract_reward",
    })
    reward: GuildReward | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    rewardId: string | null;

    @Column({ type: "json", nullable: true, default: null })
    claimPayload: Record<string, any> | null;

    @Column({ type: "datetime", precision: 6 })
    acceptedAt: Date;

    @Column({ type: "datetime", precision: 6, nullable: true, default: null })
    readyAt: Date | null;

    @Column({ type: "datetime", precision: 6, nullable: true, default: null })
    claimedAt: Date | null;

    @Column({ type: "datetime", nullable: true, default: null })
    expiresAt: Date | null;

    /** When the 24h expiry reminder was queued; null until then (design 18). */
    @Column({ type: "datetime", precision: 6, nullable: true, default: null })
    expiringNotifiedAt: Date | null;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
