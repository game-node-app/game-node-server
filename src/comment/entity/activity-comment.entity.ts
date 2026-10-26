import { UserComment } from "./user-comment.entity";
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from "typeorm";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";
import { ThreadEnabledComment } from "../comment.types";
import { StatisticsTarget } from "../../statistics/entity/statistics-target.entity";

@Entity()
@Index(["profile", "activity"])
@Index("UQ_activity_comment_statistics_target", ["statisticsTargetId"], { unique: true })
export class ActivityComment
    extends UserComment
    implements ThreadEnabledComment<ActivityComment>
{
    @ManyToOne(() => Activity, {
        nullable: false,
        onDelete: "CASCADE",
    })
    activity: Activity;
    @Column({
        nullable: false,
    })
    activityId: string;

    @OneToOne(() => StatisticsTarget, { nullable: true, onDelete: "RESTRICT" })
    @JoinColumn({ name: "statisticsTargetId" })
    statisticsTarget: StatisticsTarget | null;
    @Column({ type: "bigint", unsigned: true, nullable: true })
    statisticsTargetId: number | null;

    @OneToMany(() => ActivityComment, (comment) => comment.childOf)
    parentOf: ActivityComment[] | null;

    @ManyToOne(() => ActivityComment, {
        nullable: true,
        onDelete: "CASCADE",
    })
    childOf: ActivityComment[] | null;
    @Column({
        nullable: true,
    })
    childOfId: string | null;
}
