import { Entity, OneToMany } from "typeorm";
import { Game } from "./game.entity";
import { GameResource } from "./base/game-resource.entity";

@Entity()
export class GameFranchise extends GameResource {
    @OneToMany(() => Game, (game) => game.franchise)
    games: Game[];
}
