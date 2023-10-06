import { Column, Entity, ManyToOne, PrimaryColumn } from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class GameAlternativeName {
    @PrimaryColumn("bigint")
    id: number;
    @Column("text")
    comment: string;
    @Column("text")
    name: string;
    @Column("text")
    checksum: string;
    @ManyToOne(() => Game, (game) => game.alternativeNames)
    game: Game;
}
