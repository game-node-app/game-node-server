import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    OneToMany,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import {
    EGameExternalGameCategory,
    EGameExternalGameMedia,
} from "../../game-repository/game-repository.constants";
import { Game } from "../../game-repository/entities/game.entity";
import { GamePlatform } from "../../game-repository/entities/game-platform.entity";
import { PsnExtraMappings } from "./psn-extra-mappings.entity";

@Entity()
// This index avoids table scan in 'importer' services.
// E.g.: SELECT * FROM game_external_game geg WHERE geg.category = 1 AND geg.uid = '604140';
@Index(["uid", "category"])
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
    @ManyToOne(() => GamePlatform, {
        nullable: true,
    })
    platform: GamePlatform;
    @Column({
        nullable: true,
    })
    platformId: number;

    @OneToMany(() => PsnExtraMappings, (psm) => psm.externalGame)
    psnExtraMappings: PsnExtraMappings[] | null;
}
