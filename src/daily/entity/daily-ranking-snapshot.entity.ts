import { Column, Entity, PrimaryColumn } from "typeorm";
import {
    DailyRankingMode,
    DailyRankingPeriod,
} from "./daily-ranking-entry.entity";

/** The previous list per period partition, so a read can report position changes. */
@Entity("daily_ranking_snapshot")
export class DailyRankingSnapshot {
    @PrimaryColumn({ type: "varchar", length: 8 })
    period: DailyRankingPeriod;
    @PrimaryColumn({ type: "date" })
    periodStart: string;
    @PrimaryColumn({ type: "varchar", length: 16 })
    mode: DailyRankingMode;
    /** The São Paulo day the snapshot was taken. */
    @PrimaryColumn({ type: "date" })
    date: string;
    @PrimaryColumn({ type: "varchar", length: 36 })
    userId: string;
    @Column({ type: "int", unsigned: true })
    position: number;
}
