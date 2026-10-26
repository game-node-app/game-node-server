import {
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    Unique,
} from "typeorm";
import { StatisticsTarget } from "./statistics-target.entity";

@Entity("metric_hour")
@Unique("UQ_metric_hour_target_metric_bucket", ["targetId", "metricCode", "bucketStart"])
@Index("IDX_metric_hour_metric_bucket_target", ["metricCode", "bucketStart", "targetId"])
export class MetricHour {
    @ManyToOne(() => StatisticsTarget, { nullable: false, onDelete: "RESTRICT" })
    @JoinColumn({ name: "targetId" })
    target: StatisticsTarget;

    @Column({ type: "bigint", unsigned: true, primary: true })
    targetId: number;

    @Column({ type: "varchar", length: 32, primary: true })
    metricCode: string;

    @Column({ type: "datetime", precision: 6, primary: true })
    bucketStart: Date;

    @Column({ type: "bigint", unsigned: true, default: 0 })
    metricValue: number;
}
