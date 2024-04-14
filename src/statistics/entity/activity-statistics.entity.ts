import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from "typeorm";
import { UserView } from "./user-view.entity";
import { UserLike } from "./user-like.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";

@Entity()
export class ActivityStatistics extends Statistics {
    @OneToMany(() => UserView, (uv) => uv.gameStatistics)
    views: UserView[];
    @OneToMany(() => UserLike, (ul) => ul.gameStatistics)
    likes: UserLike[];
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
