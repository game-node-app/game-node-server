import { UserComment } from "./user-comment.entity";
import { Column, Entity, Index, ManyToOne, OneToMany } from "typeorm";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";
import { ThreadEnabledComment } from "../comment.types";

@Entity()
@Index(["profile", "activity"])
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
