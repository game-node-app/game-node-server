import {
    Column,
    CreateDateColumn,
    Entity,
    OneToMany,
    OneToOne,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { UserView } from "./user-view.entity";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";
import { UserLike } from "./user-like.entity";

@Entity()
export class ActivityStatistics {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
        default: 0,
    })
    viewsCount: number;
    @Column({
        nullable: false,
        default: 0,
    })
    likesCount: number;
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
