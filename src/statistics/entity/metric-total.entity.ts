import { Column, Entity, JoinColumn, ManyToOne, Unique } from "typeorm";
import { StatisticsTarget } from "./statistics-target.entity";

@Entity("metric_total")
@Unique("UQ_metric_total_target_metric", ["targetId", "metricCode"])
export class MetricTotal {
    @ManyToOne(() => StatisticsTarget, { nullable: false, onDelete: "RESTRICT" })
    @JoinColumn({ name: "targetId" })
    target: StatisticsTarget;

    @Column({ type: "bigint", unsigned: true, primary: true })
    targetId: number;

    @Column({ type: "varchar", length: 32, primary: true })
    metricCode: string;

    @Column({ type: "bigint", unsigned: true, default: 0 })
    metricValue: number;
}
