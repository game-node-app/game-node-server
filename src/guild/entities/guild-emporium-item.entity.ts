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
import { GuildRank } from "../guild.constants";
import { GuildReward } from "./guild-reward.entity";

/** A Lina's Emporium listing: permanent shelf or monthly rotating showcase (design 1). */
@Entity()
@Index("IDX_guild_emporium_active_rotating", ["isActive", "isRotating"])
export class GuildEmporiumItem {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @ManyToOne(() => GuildReward, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "rewardId",
        foreignKeyConstraintName: "FK_guild_emporium_item_reward",
    })
    reward: GuildReward;

    @Column({ type: "varchar", length: 36 })
    rewardId: string;

    @Column({ type: "int", unsigned: true })
    priceSeals: number;

    @Column({ type: "varchar", length: 4, default: GuildRank.E })
    minRank: GuildRank;

    @Column({ type: "boolean", default: false })
    isRotating: boolean;

    @Column({ type: "tinyint", unsigned: true, nullable: true, default: null })
    maxPurchasesPerMonth: number | null;

    @Column({ type: "boolean", default: true })
    isActive: boolean;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
