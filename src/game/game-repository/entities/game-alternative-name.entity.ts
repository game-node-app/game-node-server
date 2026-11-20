import { ApiHideProperty } from "@nestjs/swagger";
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
    // MySQL-maintained normalized copy of `name` for library search; never written or selected.
    @ApiHideProperty()
    @Column({
        type: "text",
        nullable: true,
        generatedType: "STORED",
        asExpression:
            "TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(`name`, '[\\'‘’＇]', ''), '[\\\\p{P}\\\\p{S}]+', ' '), '\\\\s+', ' '))",
        insert: false,
        update: false,
        select: false,
    })
    searchName?: string;
    @Column("text", {
        nullable: true,
    })
    checksum?: string;
    @ManyToOne(() => Game, (game) => game.alternativeNames)
    game: Game;
}
