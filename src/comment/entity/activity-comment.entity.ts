import { UserComment } from "./user-comment.entity";
import { Column, Entity, Index, ManyToOne } from "typeorm";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";
import { ReviewComment } from "./review-comment.entity";

@Entity()
@Index(["profile", "activity"])
export class ActivityComment extends UserComment {
    @ManyToOne(() => Activity, {
        nullable: false,
        onDelete: "CASCADE",
    })
    activity: Activity;
    @Column({
        nullable: false,
    })
    activityId: string;

    @ManyToOne(() => ActivityComment, {
        nullable: true,
        onDelete: "CASCADE",
    })
    childOf: ActivityComment | null;
    @Column({
        nullable: true,
    })
    childOfId: string | null;
}
