import {
    Column,
    Entity,
    Index,
    OneToMany,
    PrimaryGeneratedColumn,
} from "typeorm";
import { StatisticsSourceType } from "../statistics.constants";
import { UserLike } from "./user-like.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Collection } from "../../collections/entities/collection.entity";
import { Review } from "../../reviews/entities/review.entity";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";
import { UserView } from "./user-view.entity";

@Entity()
export class Statistics {
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * Always stored as string. May sometimes refer to a number ID.
     */
    @Column("varchar", { nullable: false, unique: true })
    sourceId: string;
    @Column({
        nullable: false,
        type: "varchar",
    })
    sourceType: StatisticsSourceType;
    @Column({
        type: "bigint",
        nullable: false,
        default: 0,
    })
    viewsCount: number;
    @Column({
        type: "bigint",
        nullable: false,
        default: 0,
    })
    likesCount: number;
    @OneToMany(() => UserView, (uv) => uv.statistics)
    views: UserView[];
    @OneToMany(() => UserLike, (ul) => ul.statistics)
    likes: UserLike[];
}
