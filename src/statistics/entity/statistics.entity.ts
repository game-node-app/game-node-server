import {
    Column,
    Entity,
    Index,
    OneToMany,
    PrimaryGeneratedColumn,
} from "typeorm";
import { StatisticsSourceType } from "../statistics.constants";
import { UserLike } from "./user-like.entity";
import { UserView } from "./user-view.entity";

@Entity()
export class Statistics {
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * Always stored as string. May sometimes refer to a number ID. <br>
     * StatisticsPipe automatically converts this to the right type before returning data. <br>
     */
    @Column("varchar", { nullable: false, unique: true })
    sourceId: string;
    @Index()
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
