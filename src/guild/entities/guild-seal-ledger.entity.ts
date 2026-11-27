import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { GuildSealReason } from "../guild.constants";

/** Append-only Guild Seals audit trail; never updated or deleted (design 1). */
@Entity()
@Index("IDX_guild_seal_ledger_user_created", ["profileUserId", "createdAt"])
export class GuildSealLedger {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_seal_ledger_profile",
    })
    profile: Profile;

    @Column({ type: "varchar", length: 36 })
    profileUserId: string;

    /** Signed: positive credit, negative debit. */
    @Column({ type: "int" })
    delta: number;

    @Column({ type: "int", unsigned: true })
    balanceAfter: number;

    @Column({ type: "varchar", length: 32 })
    reason: GuildSealReason;

    @Column({ type: "varchar", length: 64, nullable: true, default: null })
    referenceId: string | null;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;
}
