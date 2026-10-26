import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { StatisticsTarget } from "./statistics-target.entity";

export type StatisticsEventKind = "view.recorded" | "like.added" | "like.removed";
export type StatisticsEventProvenance = "live" | "legacy-recorded" | "legacy-job";
export type StatisticsProjectionState = "pending" | "done" | "failed";

@Entity("statistics_event")
@Unique("UQ_statistics_event_key", ["eventKey"])
@Index("IDX_statistics_event_due", ["projectionState", "nextAttemptAt", "id"])
@Index("IDX_statistics_event_target_time", ["targetId", "occurredAt", "id"])
@Index("IDX_statistics_event_actor_kind_time", ["actorUserId", "eventKind", "occurredAt"])
@Index("IDX_statistics_event_state_time", ["projectionState", "occurredAt"])
export class StatisticsEvent {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @Column({ type: "varchar", length: 255 })
    eventKey: string;

    @Column({ type: "tinyint", unsigned: true, default: 1 })
    eventVersion: number;

    @Column({ type: "varchar", length: 32 })
    eventKind: StatisticsEventKind;

    @ManyToOne(() => StatisticsTarget, { nullable: false, onDelete: "RESTRICT" })
    @JoinColumn({ name: "targetId" })
    target: StatisticsTarget;

    @Column({ type: "bigint", unsigned: true })
    targetId: number;

    @Column({ type: "varchar", length: 36, nullable: true })
    actorUserId: string | null;

    @Column({ type: "datetime", precision: 6 })
    occurredAt: Date;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    recordedAt: Date;

    @Column({ type: "varchar", length: 32, default: "live" })
    provenance: StatisticsEventProvenance;

    @Column({ type: "boolean", default: false })
    firstLikeCredit: boolean;

    @Column({ type: "varchar", length: 16, default: "pending" })
    projectionState: StatisticsProjectionState;

    @Column({ type: "tinyint", unsigned: true, default: 0 })
    attempts: number;

    @Column({ type: "datetime", precision: 6, default: () => "CURRENT_TIMESTAMP(6)" })
    nextAttemptAt: Date;

    @Column({ type: "varchar", length: 240, nullable: true })
    lastError: string | null;
}
