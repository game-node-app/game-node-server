import { Entity, ManyToMany, ManyToOne } from "typeorm";
import { GameResource } from "./base/game-resource.entity";
import { Game } from "./game.entity";

/**
 * TODO: update to ManyToMany
 */
@Entity()
export class GameGenre extends GameResource {
    @ManyToMany(() => Game, (game) => game.genres, {
        nullable: false,
    })
    games: Game[];
}
