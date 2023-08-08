import {
    CreateDateColumn,
    Entity,
    OneToMany,
    OneToOne,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { UserView } from "./user-view.entity";
import { Activity } from "../../activities/entities/activity.entity";
import { UserLike } from "./user-like.entity";

@Entity()
export class ActivityStatistics {
    @PrimaryColumn()
    activityId: string;
    @OneToMany(() => UserView, (userView) => userView.activityStatistics)
    views: UserView[];
    @OneToMany(() => UserLike, (userLike) => userLike.activityStatistics)
    likes: UserLike[];
    @OneToOne(() => Activity, (activity) => activity.statistics)
    activity: Activity;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
