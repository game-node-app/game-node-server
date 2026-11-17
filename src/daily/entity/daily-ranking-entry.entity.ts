import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { DailyMode } from "../daily.constants";

export type DailyRankingPeriod = "today" | "week" | "month" | "all";
/** Overall rows include the completion bonus; mode rows are one DailyMode. */
export type DailyRankingMode = DailyMode | "overall";

/**
 * One player's derived totals for one period partition, filter and mode.
 * Written only by `recompute` from `daily_result`, with absolute values.
 */
@Entity("daily_ranking_entry")
@Index("IDX_daily_ranking_entry_order", [
    "period",
    "periodStart",
    "mode",
    "points",
    "winAttempts",
    "lastFinishedAt",
    "userId",
])
export class DailyRankingEntry {
    @PrimaryColumn({ type: "varchar", length: 8 })
    period: DailyRankingPeriod;
    /** Today, the Monday, the 1st, or 2000-01-01 for `all`. */
    @PrimaryColumn({ type: "date" })
    periodStart: string;
    @PrimaryColumn({ type: "varchar", length: 16 })
    mode: DailyRankingMode;
    @PrimaryColumn({ type: "varchar", length: 36 })
    userId: string;
    @ManyToOne(() => Profile, { onDelete: "CASCADE" })
    @JoinColumn({
        name: "userId",
        foreignKeyConstraintName: "FK_daily_ranking_entry_profile",
    })
    profile: Profile;
    /** Tenths of a point; the completion bonus is included on overall rows. */
    @Column({ type: "int", unsigned: true, default: 0 })
    points: number;
    @Column({ type: "int", unsigned: true, default: 0 })
    coverPoints: number;
    @Column({ type: "int", unsigned: true, default: 0 })
    artworkPoints: number;
    @Column({ type: "int", unsigned: true, default: 0 })
    keywordsPoints: number;
    @Column({ type: "int", unsigned: true, default: 0 })
    specsPoints: number;
    @Column({ type: "int", unsigned: true, default: 0 })
    wins: number;
    @Column({ type: "int", unsigned: true, default: 0 })
    played: number;
    /** Sum of attempts across counted wins; the first tie-break. */
    @Column({ type: "int", unsigned: true, default: 0 })
    winAttempts: number;
    @Column({ type: "datetime" })
    lastFinishedAt: Date;
    /** The same totals without today's puzzles, for position changes. */
    @Column({ type: "int", unsigned: true, default: 0 })
    prevPoints: number;
    @Column({ type: "int", unsigned: true, default: 0 })
    prevPlayed: number;
    @Column({ type: "int", unsigned: true, default: 0 })
    prevWinAttempts: number;
    @Column({ type: "datetime", nullable: true })
    prevLastFinishedAt: Date | null;
    /** São Paulo day of the recompute that wrote the row. */
    @Column({ type: "date" })
    asOf: string;
    /** `all` overall rows only: latest run of days with a counted win. */
    @Column({ type: "int", unsigned: true, default: 0 })
    streak: number;
    @Column({ type: "date", nullable: true })
    streakEnd: string | null;
    /** `all` mode rows only: longest run of days won in that mode. */
    @Column({ type: "int", unsigned: true, default: 0 })
    bestStreak: number;
}
