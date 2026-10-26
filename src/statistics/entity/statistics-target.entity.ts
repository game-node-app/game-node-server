import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";
import { StatisticsSourceType } from "../statistics.constants";

@Entity("statistics_target")
export class StatisticsTarget {
    @PrimaryGeneratedColumn({ type: "bigint", unsigned: true })
    id: number;

    @Column({ type: "varchar", length: 32 })
    sourceType: StatisticsSourceType;

    @Column({ type: "boolean", default: true })
    isActive: boolean;

    @CreateDateColumn({ type: "datetime", precision: 6 })
    createdAt: Date;
}
