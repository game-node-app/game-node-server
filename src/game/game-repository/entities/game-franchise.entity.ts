import { Entity, ManyToMany, OneToMany } from "typeorm";
import { Game } from "./game.entity";
import { GameResource } from "./base/game-resource.entity";

@Entity()
export class GameFranchise extends GameResource {
    @ManyToMany(() => Game, (game) => game.franchises)
    games: Game[];
}
