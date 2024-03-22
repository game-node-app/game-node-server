import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";
import { UserView } from "./user-view.entity";
import { UserLike } from "./user-like.entity";

@Entity()
export class GameStatistics extends Statistics {
    @OneToMany(() => UserView, (uv) => uv.gameStatistics)
    views: UserView[];
    @OneToMany(() => UserLike, (ul) => ul.gameStatistics)
    likes: UserLike[];
    @OneToOne(() => Game, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinColumn()
    game: Game;
    @Column({
        nullable: false,
    })
    gameId: number;
}
