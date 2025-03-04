import { Statistics } from "./statistics.entity";
import { Column, Entity, JoinColumn, OneToOne } from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";

@Entity()
export class GameStatistics extends Statistics {
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
