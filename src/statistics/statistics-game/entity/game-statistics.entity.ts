import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    OneToMany,
    OneToOne,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { UserLike } from "../../entity/user-like.entity";
import { UserView } from "../../entity/user-view.entity";
import { Game } from "../../../game/game-repository/entities/game.entity";

/**
 * Statistics for a single game
 *
 * Since IGDB games are not stored in our end, no relationship is needed.
 * The primary key is the IGDB id.
 */
@Entity()
export class GameStatistics {
    @PrimaryGeneratedColumn()
    id: number;
    @OneToOne(() => Game, {
        nullable: false,
    })
    @JoinColumn()
    game: Game;
    @Column({
        nullable: false,
        default: 0,
    })
    likesCount: number;
    @OneToMany(() => UserLike, (userLike) => userLike.gameStatistics)
    likes: UserLike[];
    @Column({
        nullable: false,
        default: 0,
    })
    viewsCount: number;
    @OneToMany(() => UserView, (userView) => userView.gameStatistics)
    views: UserView[];
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
