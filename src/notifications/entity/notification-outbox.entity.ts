import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";

export type NotificationOutboxState =
    | "pending"
    | "processing"
    | "completed"
    | "failed"
    | "suppressed";

@Entity("notification_outbox")
@Index("IDX_notification_outbox_due", ["state", "nextAttemptAt"])
@Index("IDX_notification_outbox_lease", ["state", "ownerExpiresAt"])
@Index("IDX_notification_outbox_owner", ["ownerToken"])
export class NotificationOutbox {
    @PrimaryColumn({ type: "varchar", length: 255 })
    id: string;

    @Column({ type: "varchar", length: 64 })
    eventType: string;

    @Column({ type: "int", default: 1 })
    eventVersion: number;

    @Column({ type: "timestamp", precision: 3 })
    occurredAt: Date;

    @Column({ type: "varchar", length: 255, nullable: true })
    recipientUserId: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    actorUserId: string | null;

    @Column({ type: "json" })
    payload: Record<string, any>;

    @Column({ type: "varchar", length: 32, default: "pending" })
    state: NotificationOutboxState;

    @Column({ type: "varchar", length: 255, nullable: true })
    ownerToken: string | null;

    @Column({ type: "timestamp", precision: 3, nullable: true })
    ownerExpiresAt: Date | null;

    @Column({ type: "int", default: 0 })
    attempts: number;

    @Column({ type: "timestamp", precision: 3 })
    nextAttemptAt: Date;

    @Column({ type: "timestamp", precision: 3, nullable: true })
    completedAt: Date | null;

    @Column({ type: "text", nullable: true })
    lastError: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
