import { Column, Entity, ManyToOne, PrimaryColumn } from "typeorm";
import { Game } from "./game.entity";
import { GameImage } from "./base/game-image.entity";

@Entity()
export class GameArtwork extends GameImage {
    @ManyToOne(() => Game, (game) => game.artworks)
    game: Game;
}
