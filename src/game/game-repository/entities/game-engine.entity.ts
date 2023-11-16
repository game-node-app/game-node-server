import { GameResource } from "./base/game-resource.entity";
import { Entity, JoinTable, ManyToMany, OneToOne } from "typeorm";
import { GameCompany } from "./game-company.entity";
import { GamePlatform } from "./game-platform.entity";
import { Game } from "./game.entity";
import { GameEngineLogo } from "./game-engine-logo.entity";

@Entity()
export class GameEngine extends GameResource {
    @OneToOne(() => GameEngineLogo, (logo) => logo.engine)
    logo: GameEngineLogo;
    @ManyToMany(() => GameCompany)
    @JoinTable()
    companies: GameCompany[];
    @ManyToMany(() => GamePlatform)
    @JoinTable()
    platforms: GamePlatform[];
    @ManyToMany(() => Game, (game) => game.gameEngines)
    games: Game[];
}
