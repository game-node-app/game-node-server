import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { GuildEmporiumItem } from "./guild-emporium-item.entity";

/** One completed Emporium purchase, kept for monthly caps and audit (design 1). */
@Entity()
@Index("IDX_guild_emporium_purchase_user_item_month", [
    "profileUserId",
    "emporiumItemId",
    "monthKey",
])
export class GuildEmporiumPurchase {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_emporium_purchase_profile",
    })
    profile: Profile;

    @Column({ type: "varchar", length: 36 })
    profileUserId: string;

    @ManyToOne(() => GuildEmporiumItem, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn({
        name: "emporiumItemId",
        foreignKeyConstraintName: "FK_guild_emporium_purchase_item",
    })
    emporiumItem: GuildEmporiumItem;

    @Column({ type: "varchar", length: 36 })
    emporiumItemId: string;

    /** "YYYY-MM" São Paulo month of the purchase. */
    @Column({ type: "char", length: 7 })
    monthKey: string;

    @Column({ type: "int", unsigned: true })
    priceSeals: number;

    @Column({ type: "datetime", precision: 6 })
    purchasedAt: Date;
}
