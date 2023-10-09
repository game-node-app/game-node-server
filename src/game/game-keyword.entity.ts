import { GameResource } from "./entities/base/game-resource.entity";
import { Entity, ManyToOne } from "typeorm";
import { Game } from "./entities/game.entity";

@Entity()
export class GameKeyword extends GameResource {
    @ManyToOne(() => Game, (game) => game.keywords, {
        nullable: false,
    })
    game: Game;
}
