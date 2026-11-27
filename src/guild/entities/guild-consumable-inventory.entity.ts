import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { GuildConsumableKey } from "../guild.constants";

/** Per-user Guild utility consumable balance (design 1). */
@Entity()
export class GuildConsumableInventory {
    @PrimaryColumn({ type: "varchar", length: 36 })
    profileUserId: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_consumable_inventory_profile",
    })
    profile: Profile;

    @PrimaryColumn({ type: "varchar", length: 32 })
    consumableKey: GuildConsumableKey;

    @Column({ type: "int", unsigned: true, default: 0 })
    quantity: number;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
