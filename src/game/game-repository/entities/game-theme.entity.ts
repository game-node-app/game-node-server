import { GameResource } from "./base/game-resource.entity";
import { Entity, ManyToMany } from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class GameTheme extends GameResource {
    @ManyToMany(() => Game, (game) => game.themes)
    games?: Game[];
}
