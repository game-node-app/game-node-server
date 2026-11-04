import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("igdb_delta_state")
export class IgdbDeltaState {
    @PrimaryColumn({ type: "varchar", length: 64 })
    stream: string;

    @Column({ type: "datetime", precision: 3, nullable: true })
    watermark: Date | null = null;

    @Column({ type: "datetime", precision: 3, nullable: true })
    windowStart: Date | null = null;

    @Column({ type: "datetime", precision: 3, nullable: true })
    windowEnd: Date | null = null;

    @Column({ type: "int", unsigned: true, default: 0 })
    cursor = 0;

    @Column({ type: "varchar", length: 512, nullable: true })
    failureSummary: string | null = null;

    @Column({ type: "datetime", precision: 3, nullable: true })
    pausedUntil: Date | null = null;

    @Column({ type: "varchar", length: 36, nullable: true })
    ownerToken: string | null = null;

    @Column({ type: "int", unsigned: true, default: 0 })
    ownerGeneration = 0;

    @Column({ type: "datetime", precision: 3, nullable: true })
    leaseExpiresAt: Date | null = null;
}
