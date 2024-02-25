import { Entity, ManyToMany } from "typeorm";
import { GameResource } from "./base/game-resource.entity";
import { Game } from "./game.entity";

@Entity()
export class GameMode extends GameResource {
    @ManyToMany(() => Game, (game) => game.gameModes, {
        nullable: false,
    })
    game: Game;
}
