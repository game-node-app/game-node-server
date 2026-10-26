import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity("notification_inbox")
@Index("UQ_notification_inbox_recipient_group", ["recipientUserId", "groupKey"], {
    unique: true,
})
@Index("IDX_notification_inbox_pagination", [
    "recipientUserId",
    "lastEventAt",
    "id",
])
@Index("IDX_notification_inbox_unread", [
    "recipientUserId",
    "isVisible",
    "readVersion",
    "version",
])
@Index("IDX_notification_inbox_subject", ["subjectType", "subjectId"])
@Index("IDX_notification_inbox_root", ["rootType", "rootId"])
@Index("IDX_notification_inbox_trigger", ["triggerCommentId"])
export class NotificationInbox {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 255 })
    recipientUserId: string;

    @Column({ type: "varchar", length: 255 })
    groupKey: string;

    @Column({ type: "varchar", length: 64 })
    type: string;

    @Column({ type: "varchar", length: 64, nullable: true })
    subjectType: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    subjectId: string | null;

    @Column({ type: "varchar", length: 64, nullable: true })
    rootType: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    rootId: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    triggerCommentId: string | null;

    @Column({ type: "json", nullable: true })
    preview: Record<string, any> | null;

    @Column({ type: "json", nullable: true })
    target: Record<string, any> | null;

    @Column({ type: "json" })
    actorIds: string[];

    @Column({ type: "int", default: 1 })
    eventCount: number;

    @Column({ type: "int", default: 1 })
    actorCount: number;

    @Column({ type: "timestamp", precision: 3 })
    lastEventAt: Date;

    @Column({ type: "int", default: 1 })
    version: number;

    @Column({ type: "int", default: 0 })
    readVersion: number;

    @Column({ type: "boolean", default: true })
    isVisible: boolean;

    @Column({ type: "boolean", default: false })
    isRedacted: boolean;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
