import { Entity, OneToOne } from "typeorm";
import { GameImage } from "./base/game-image.entity";
import { GameEngine } from "./game-engine.entity";

@Entity()
export class GameEngineLogo extends GameImage {
    @OneToOne(() => GameEngine, (engine) => engine.logo)
    engine: GameEngine;
}
