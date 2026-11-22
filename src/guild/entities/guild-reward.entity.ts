import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { AchievementDefinition } from "../../achievements/entities/achievement-definition.entity";
import { GuildRewardKind } from "../guild.constants";

/** A Guild badge, title, avatar frame or weekly chest (design 1). */
@Entity()
@Unique("UQ_guild_reward_key", ["key"])
export class GuildReward {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @Column({ type: "varchar", length: 64 })
    key: string;

    @Column({ type: "varchar", length: 24 })
    kind: GuildRewardKind;

    @ManyToOne(() => AchievementDefinition, {
        nullable: true,
        onDelete: "SET NULL",
    })
    @JoinColumn({
        name: "achievementId",
        foreignKeyConstraintName: "FK_guild_reward_achievement",
    })
    achievement: AchievementDefinition | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    achievementId: string | null;

    @Column({ type: "boolean", default: false })
    inChestPool: boolean;

    @Column({ type: "int", unsigned: true, default: 0 })
    chestBonusXp: number;

    @Column({ type: "boolean", default: true })
    isActive: boolean;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
