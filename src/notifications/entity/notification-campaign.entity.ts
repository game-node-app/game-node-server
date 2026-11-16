import { Column, CreateDateColumn, Entity, PrimaryColumn } from "typeorm";

/**
 * One "send this to many users once" fan-out, advanced by `cursorUserId` in batches (design 8).
 */
@Entity("notification_campaign")
export class NotificationCampaign {
    @PrimaryColumn({ type: "varchar", length: 255 })
    key: string;
    @Column({ type: "varchar", length: 64 })
    eventType: string;
    @Column({ type: "json" })
    payload: Record<string, unknown>;
    @Column({ type: "varchar", length: 36, nullable: true })
    cursorUserId: string | null;
    @Column({ type: "timestamp", precision: 3, nullable: true })
    completedAt: Date | null;
    @CreateDateColumn({ type: "timestamp", precision: 6 })
    createdAt: Date;
}
