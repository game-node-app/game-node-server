import { GameResource } from "./base/game-resource.entity";
import { Entity, ManyToMany } from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class GameKeyword extends GameResource {
    @ManyToMany(() => Game, (game) => game.keywords, {
        nullable: false,
    })
    game: Game;
}
