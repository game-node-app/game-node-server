import { Column, Entity, ManyToOne, PrimaryColumn } from "typeorm";
import { Game } from "./game.entity";

@Entity()
export class GameAlternativeName {
    @PrimaryColumn("bigint")
    id: number;
    @Column("text", {
        nullable: true,
    })
    comment?: string;
    @Column("text", {
        nullable: true,
    })
    name?: string;
    @Column("text", {
        nullable: true,
    })
    checksum?: string;
    @ManyToOne(() => Game, (game) => game.alternativeNames)
    game: Game;
}
