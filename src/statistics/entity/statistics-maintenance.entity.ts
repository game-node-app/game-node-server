import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("statistics_maintenance")
export class StatisticsMaintenance {
    @PrimaryColumn({ type: "varchar", length: 64 })
    id: string;

    @Column({ type: "varchar", length: 32, default: "idle" })
    operation: string;

    @Column({ type: "varchar", length: 255, nullable: true })
    cursor: string | null;

    @Column({ type: "varchar", length: 16, default: "pending" })
    state: string;

    @Column({ type: "datetime", precision: 6, nullable: true })
    historyCompleteSince: Date | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    backupReference: string | null;

    @Column({ type: "json", nullable: true })
    report: Record<string, unknown> | null;

    @UpdateDateColumn({ type: "datetime", precision: 6 })
    updatedAt: Date;
}
