import { Entity, ManyToOne } from "typeorm";
import { GameResource } from "./base/game-resource.entity";
import { Game } from "./game.entity";

@Entity()
export class GameGenre extends GameResource {
    @ManyToOne(() => Game, (game) => game.genres, {
        nullable: false,
    })
    game: Game;
}
