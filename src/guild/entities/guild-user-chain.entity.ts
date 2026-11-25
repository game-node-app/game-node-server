import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
    Unique,
} from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { GuildChainStatus } from "../guild.constants";

/** A member's progress through one 3-stage narrative Quest Chain (design 1). */
@Entity()
@Unique("UQ_guild_user_chain_user_chain", ["profileUserId", "chainKey"])
export class GuildUserChain {
    @PrimaryColumn({ type: "varchar", length: 36 })
    id: string;

    @ManyToOne(() => Profile, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "profileUserId",
        referencedColumnName: "userId",
        foreignKeyConstraintName: "FK_guild_user_chain_profile",
    })
    profile: Profile;

    @Column({ type: "varchar", length: 36 })
    profileUserId: string;

    @Column({ type: "varchar", length: 64 })
    chainKey: string;

    @Column({
        type: "varchar",
        length: 16,
        default: GuildChainStatus.IN_PROGRESS,
    })
    status: GuildChainStatus;

    @Column({ type: "tinyint", unsigned: true, default: 0 })
    currentStageIndex: number;

    @ManyToOne(() => Game, { nullable: true, onDelete: "SET NULL" })
    @JoinColumn({
        name: "boundTargetGameId",
        foreignKeyConstraintName: "FK_guild_user_chain_game",
    })
    boundTargetGame: Game | null;

    @Column({ type: "bigint", nullable: true, default: null })
    boundTargetGameId: number | null;

    @Column({ type: "varchar", length: 36, nullable: true, default: null })
    activeContractId: string | null;

    @Column({ type: "datetime", precision: 6 })
    startedAt: Date;

    @Column({ type: "datetime", precision: 6, nullable: true, default: null })
    completedAt: Date | null;
}
