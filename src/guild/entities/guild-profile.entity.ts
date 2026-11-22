import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToOne,
    PrimaryColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { GuildRank } from "../guild.constants";

/**
 * One row per Guild member, created lazily on the first Guild visit (design 1).
 * `licenseNumber` is AUTO_INCREMENT in the migration; TypeORM never writes it.
 */
@Entity()
@Unique("UQ_guild_profile_license_number", ["licenseNumber"])
export class GuildProfile {
    @PrimaryColumn({ type: "varchar", length: 36 })
    profileUserId: string;

    @OneToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_profile_profile",
    })
    profile: Profile;

    @Column({ type: "int", unsigned: true, generated: "increment" })
    licenseNumber: number;

    @Column({ type: "int", unsigned: true, default: 0 })
    xp: number;

    @Column({ type: "varchar", length: 4, default: GuildRank.E })
    rank: GuildRank;

    @Column({ type: "datetime", precision: 6, nullable: true, default: null })
    lastBoardSeenAt: Date | null;

    @Column({ type: "datetime", precision: 6, nullable: true, default: null })
    lastVisitedAt: Date | null;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
