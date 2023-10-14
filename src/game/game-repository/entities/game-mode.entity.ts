import { Entity, ManyToOne } from "typeorm";
import { GameResource } from "./base/game-resource.entity";
import { Game } from "./game.entity";

@Entity()
export class GameMode extends GameResource {
    @ManyToOne(() => Game, (game) => game.gameModes, {
        nullable: false,
    })
    game: Game;
}
