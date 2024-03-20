import {
    Column,
    Entity,
    Index,
    JoinColumn,
    OneToMany,
    OneToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { StatisticsSourceType } from "../statistics.constants";
import { UserLike } from "./user-like.entity";
import { UserView } from "./user-view.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Review } from "../../reviews/entities/review.entity";

@Entity()
export class Statistics {
    @PrimaryGeneratedColumn()
    id: number;
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
    @Index()
    viewsCount: number;
    @Column({
        type: "bigint",
        nullable: false,
        default: 0,
    })
    @Index()
    likesCount: number;
    @OneToMany(() => UserView, (uv) => uv.statistics)
    views: UserView[];
    @OneToMany(() => UserLike, (ul) => ul.statistics)
    likes: UserLike[];
    @OneToOne(() => Game, {
        nullable: true,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    game?: Game;
    @Column({
        nullable: true,
    })
    gameId?: number;
    @OneToOne(() => Review, {
        nullable: true,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    review?: Review;
    @Column({
        nullable: true,
    })
    reviewId?: string;
}
