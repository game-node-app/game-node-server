import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { Game } from "./game.entity";
import { GameImage } from "./base/game-image.entity";

@Entity()
export class GameCover extends GameImage {
    @OneToOne(() => Game, (game) => game.cover)
    @JoinColumn()
    game: Game;
}
