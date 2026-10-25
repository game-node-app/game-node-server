import {
    Column,
    Entity,
    Index,
    JoinColumn,
    OneToOne,
    PrimaryColumn,
} from "typeorm";
import { UserConnection } from "../../../connection/entity/user-connection.entity";
import type { ProviderFailureOutcome } from "../../provider-sync.error";

export type PlayerSyncOutcome =
    | "unknown"
    | "complete"
    | "empty"
    | ProviderFailureOutcome;
export type PlayerSyncStage = "playtime" | "discovery";
export interface PlayerStageState {
    outcome: PlayerSyncOutcome;
    lastSucceededAt: string | null;
    nextEligibleAt: string;
}

@Entity("player_connection_sync")
@Index("IDX_player_connection_due", ["nextEligibleAt", "connectionId"])
export class PlayerConnectionSync {
    @PrimaryColumn({ type: "int" })
    connectionId: number;

    @OneToOne(() => UserConnection, { onDelete: "CASCADE" })
    @JoinColumn({
        name: "connectionId",
        foreignKeyConstraintName: "FK_player_connection_sync",
    })
    connection: UserConnection;

    @Column({ type: "varchar", length: 255 })
    sourceUserId: string;

    @Column({ type: "datetime", precision: 3, nullable: true })
    lastSucceededAt: Date | null = null;

    @Column({ type: "datetime", precision: 3 })
    nextEligibleAt: Date;

    @Column({ type: "json" })
    stages: Record<PlayerSyncStage, PlayerStageState>;

    @Column({ type: "varchar", length: 16, default: "unknown" })
    outcome: PlayerSyncOutcome = "unknown";

    @Column({ type: "datetime", precision: 3, nullable: true })
    retryAt: Date | null = null;

    @Column({ type: "varchar", length: 36, nullable: true })
    ownerToken: string | null = null;

    @Column({ type: "datetime", precision: 3, nullable: true })
    leaseExpiresAt: Date | null = null;

    @Column({ type: "datetime", precision: 3, nullable: true })
    attemptStartedAt: Date | null = null;
}
