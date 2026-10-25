import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from "typeorm";
import { UserConnection } from "../../../connection/entity/user-connection.entity";
import { GameExternalGame } from "../../../game/external-game/entity/game-external-game.entity";
import type { PlayerSyncOutcome } from "./player-connection-sync.entity";

@Entity("player_game_sync")
@Index("IDX_player_game_external", ["externalGameId"])
export class PlayerGameSync {
    @PrimaryColumn({ type: "int" })
    connectionId: number;
    @PrimaryColumn({ type: "bigint" })
    externalGameId: number;

    @ManyToOne(() => UserConnection, { onDelete: "CASCADE" })
    @JoinColumn({
        name: "connectionId",
        foreignKeyConstraintName: "FK_player_game_connection",
    })
    connection: UserConnection;
    @ManyToOne(() => GameExternalGame, { onDelete: "CASCADE" })
    @JoinColumn({
        name: "externalGameId",
        foreignKeyConstraintName: "FK_player_game_external",
    })
    externalGame: GameExternalGame;

    @Column({ type: "varchar", length: 255 })
    sourceUserId: string;
    @Column({ type: "datetime", precision: 3, nullable: true })
    checkedAt: Date | null = null;
    @Column({ type: "varchar", length: 16, default: "unknown" })
    outcome: PlayerSyncOutcome = "unknown";
    @Column({ type: "varchar", length: 64, nullable: true })
    activityFingerprint: string | null = null;
    @Column({ type: "datetime", precision: 3 })
    nextEligibleAt: Date;
    @Column({ type: "datetime", precision: 3 })
    reconcileAt: Date;
    @Column({ type: "datetime", precision: 3, nullable: true })
    retryAt: Date | null = null;
    @Column({ type: "varchar", length: 36, nullable: true })
    ownerToken: string | null = null;
    @Column({ type: "datetime", precision: 3, nullable: true })
    leaseExpiresAt: Date | null = null;
    @Column({ type: "datetime", precision: 3, nullable: true })
    attemptStartedAt: Date | null = null;
}
