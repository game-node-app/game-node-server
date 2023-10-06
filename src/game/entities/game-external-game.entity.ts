import { Entity } from "typeorm";

/**
 * Funky name, i know.
 */
@Entity()
export class GameExternalGame {
    @PrimaryColumn("bigint")
    id: number;
    @Column()
    category;
}
