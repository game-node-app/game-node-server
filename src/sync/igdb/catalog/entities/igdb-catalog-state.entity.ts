import { Check, Column, Entity, PrimaryColumn } from "typeorm";

export type CatalogStatus = "idle" | "running" | "paused" | "completed";
export type CatalogStage =
    | "upper"
    | "fetch"
    | "game"
    | "checkpoint"
    | "complete";

@Entity("igdb_catalog_state")
@Check("CHK_igdb_catalog_singleton", "`id` = 1")
export class IgdbCatalogState {
    @PrimaryColumn({ type: "tinyint", unsigned: true, default: 1 })
    id: number = 1;

    @Column({ type: "varchar", length: 36, nullable: true })
    runId: string | null = null;

    @Column({
        type: "enum",
        enum: ["idle", "running", "paused", "completed"],
        default: "idle",
    })
    status: CatalogStatus = "idle";

    @Column({ type: "int", unsigned: true, default: 0 })
    committedId: number = 0;

    @Column({ type: "int", unsigned: true, nullable: true })
    upperId: number | null = null;

    @Column({ type: "boolean", default: true })
    forceReconciliation: boolean = true;

    @Column({ type: "int", unsigned: true, default: 0 })
    committedGames: number = 0;

    @Column({ type: "int", unsigned: true, default: 0 })
    committedBatches: number = 0;

    @Column({ type: "datetime", precision: 3, nullable: true })
    startedAt: Date | null = null;

    @Column({ type: "datetime", precision: 3, nullable: true })
    completedAt: Date | null = null;

    @Column({ type: "datetime", precision: 3, nullable: true })
    nextEligibleAt: Date | null = null;

    @Column({ type: "varchar", length: 16, nullable: true })
    retryStage: CatalogStage | null = null;

    @Column({ type: "int", unsigned: true, nullable: true })
    retryGameId: number | null = null;

    @Column({ type: "tinyint", unsigned: true, default: 0 })
    attempt: number = 0;

    @Column({ type: "json", nullable: true })
    retryBudgets: Record<string, number> | null = null;

    @Column({ type: "varchar", length: 512, nullable: true })
    failureSummary: string | null = null;

    @Column({ type: "int", unsigned: true, default: 0 })
    ownerGeneration: number = 0;

    @Column({ type: "varchar", length: 36, nullable: true })
    ownerToken: string | null = null;

    @Column({ type: "datetime", precision: 3, nullable: true })
    leaseExpiresAt: Date | null = null;
}
