import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { GuildReward } from "./guild-reward.entity";

/** A permanently unlocked Guild cosmetic (design 1). */
@Entity()
@Unique("UQ_user_guild_reward_profile_reward", ["profileUserId", "rewardId"])
export class UserGuildReward {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_user_guild_reward_profile",
    })
    profile: Profile;

    @Column({ type: "varchar", length: 36 })
    profileUserId: string;

    @ManyToOne(() => GuildReward, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "rewardId",
        foreignKeyConstraintName: "FK_user_guild_reward_reward",
    })
    reward: GuildReward;

    @Column({ type: "varchar", length: 36 })
    rewardId: string;

    /** Contract that unlocked this cosmetic; kept after the contract row is gone. */
    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    sourceContractId: string | null;

    @Column({ type: "datetime", precision: 6 })
    unlockedAt: Date;
}
