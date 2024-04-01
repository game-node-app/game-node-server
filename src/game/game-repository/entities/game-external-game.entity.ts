import {
    Column,
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import {
    EGameExternalGameCategory,
    EGameExternalGameMedia,
} from "../game-repository.constants";
import { Game } from "./game.entity";

@Entity()
export class GameExternalGame {
    @PrimaryColumn("bigint")
    id: number;

    /**
     * Corresponds to the game id on the target source (see GameExternalGameCategory).
     * It's called uid, not uuid.
     */
    @Column({
        type: "varchar",
        length: 255,
    })
    uid: string;
    @Column({
        nullable: true,
    })
    category?: EGameExternalGameCategory;
    @Column({
        nullable: true,
    })
    media?: EGameExternalGameMedia;
    @Column("text", {
        nullable: true,
    })
    checksum?: string;
    @Column("text", {
        nullable: true,
    })
    name?: string;
    @Column("text", {
        nullable: true,
    })
    url?: string;
    @Column("int", {
        nullable: true,
    })
    year?: number;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
    // Relationships
    @ManyToOne(() => Game, (game) => game.externalGames, {
        nullable: false,
    })
    game: Game;
    @Column({
        nullable: false,
    })
    gameId: number;
}
