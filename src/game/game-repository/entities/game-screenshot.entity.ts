import { Entity, ManyToOne, OneToOne } from "typeorm";
import { GameImage } from "./base/game-image.entity";
import { Game } from "./game.entity";

@Entity()
export class GameScreenshot extends GameImage {
    @ManyToOne(() => Game, (game) => game.screenshots)
    game: Game;
}
