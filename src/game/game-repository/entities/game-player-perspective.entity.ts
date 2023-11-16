import { GameResource } from "./base/game-resource.entity";
import { Entity, ManyToMany } from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class GamePlayerPerspective extends GameResource {
    @ManyToMany(() => Game, (game) => game.playerPerspectives)
    games: Game[];
}
