import { Column, Entity, ManyToOne, PrimaryColumn } from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class GameArtwork {
    @PrimaryColumn("bigint")
    id: number;
    @Column("boolean")
    alphaChannel: boolean;
    @Column("boolean")
    animated: boolean;
    @Column("int")
    height: number;
    @Column("text")
    imageId: string;
    @Column("text")
    url: string;
    @Column("int")
    width: number;
    @ManyToOne(() => Game, (game) => game.artworks)
    game: Game;
}
