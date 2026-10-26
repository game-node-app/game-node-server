import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    Unique,
} from "typeorm";
import { StatisticsTarget } from "./statistics-target.entity";

@Entity("ranking_score")
@Unique("UQ_ranking_score_key_target", ["rankingKey", "targetId"])
@Index("IDX_ranking_score_order", ["rankingKey", "score", "targetId"])
export class RankingScore {
    @Column({ type: "varchar", length: 32, primary: true })
    rankingKey: string;

    @ManyToOne(() => StatisticsTarget, { nullable: false, onDelete: "RESTRICT" })
    @JoinColumn({ name: "targetId" })
    target: StatisticsTarget;

    @Column({ type: "bigint", unsigned: true, primary: true })
    targetId: number;

    @Column({ type: "double", default: 0 })
    score: number;

    @Column({ type: "varchar", length: 32 })
    definitionVersion: string;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    computedAt: Date;
}
