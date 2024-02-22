import { Statistics } from "./statistics.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Column, JoinColumn, OneToOne } from "typeorm";

export class GameStatistics extends Statistics {
    @OneToOne(() => Game, {
        nullable: false,
    })
    @JoinColumn({
        name: "sourceId",
    })
    source: Game;
    @Column()
    sourceId: number;
}
