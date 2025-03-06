import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToOne } from "typeorm";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";

@Entity()
export class ActivityStatistics extends Statistics {
    @OneToOne(() => Activity, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    activity: Activity;
    @Column({
        nullable: false,
    })
    activityId: string;
}
