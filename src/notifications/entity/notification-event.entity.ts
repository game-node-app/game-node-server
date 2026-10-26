import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    PrimaryGeneratedColumn,
} from "typeorm";

@Entity("notification_event")
@Index("UQ_notification_event_recipient", ["eventId", "recipientUserId"], {
    unique: true,
})
@Index("IDX_notification_event_group", ["groupKey"])
@Index("IDX_notification_event_recipient_group", ["recipientUserId", "groupKey"])
@Index("IDX_notification_event_group_actor", ["groupKey", "actorUserId"])
@Index("IDX_notification_event_subject", ["subjectType", "subjectId"])
@Index("IDX_notification_event_root", ["rootType", "rootId"])
@Index("IDX_notification_event_trigger", ["triggerCommentId"])
export class NotificationEvent {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 255 })
    eventId: string;

    @Column({ type: "varchar", length: 255 })
    recipientUserId: string;

    @Column({ type: "varchar", length: 255 })
    groupKey: string;

    @Column({ type: "varchar", length: 64 })
    eventType: string;

    @Column({ type: "varchar", length: 255, nullable: true })
    actorUserId: string | null;

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

    @Column({ type: "timestamp", precision: 3 })
    occurredAt: Date;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
