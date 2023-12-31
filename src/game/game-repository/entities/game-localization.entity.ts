import { Entity, ManyToOne } from "typeorm";
import { GameResource } from "./base/game-resource.entity";
import { Game } from "./game.entity";

@Entity()
export class GameLocalization extends GameResource {
    @ManyToOne(() => Game, (game) => game.gameLocalizations, {
        nullable: false,
    })
    game: Game;
}
