import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    OneToOne,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { GameAlternativeName } from "./game-alternative-name.entity";
import { GameArtwork } from "./game-artwork.entity";
import { GameCategory } from "../game.constants";
import { GameCollection } from "./game-collection.entity";
import { GameCover } from "./game-cover.entity";
import { GameScreenshot } from "./game-screenshot.entity";

/**
 * I've tried to work my way with this using cascades, but it didn't work.
 * TypeORM has trouble handling relationship updates when using cascades.
 * */

@Entity()
export class Game {
    /**
     * Should be mapped to the IGDB ID of the game.
     * */
    @PrimaryColumn({
        type: "bigint",
    })
    id: number;

    // Fields
    @Column()
    name: string;
    @Column("double", {
        nullable: true,
    })
    aggregatedRating?: number;
    @Column("int", {
        nullable: true,
    })
    aggregatedRatingCount?: number;
    @Column({
        default: GameCategory.Main,
    })
    category: GameCategory;
    @Column("text", {
        nullable: true,
    })
    checksum: string;
    @Column({
        nullable: true,
    })
    firstReleaseDate: Date;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;

    // Relationships
    @OneToOne(() => GameCover, (cover) => cover.game, {
        nullable: true,
    })
    cover?: GameCover;

    @ManyToOne(() => GameCollection, (gameCollection) => gameCollection.games, {
        nullable: true,
    })
    collection?: GameCollection;
    @OneToMany(
        () => GameAlternativeName,
        (gameAlternativeName) => gameAlternativeName.game,
        {
            nullable: true,
        },
    )
    alternativeNames?: GameAlternativeName[];

    @OneToMany(() => GameArtwork, (gameArtwork) => gameArtwork.game, {
        nullable: true,
    })
    artworks?: GameArtwork[];
    @OneToMany(() => GameScreenshot, (gameScreenshot) => gameScreenshot.game, {
        nullable: true,
    })
    screenshots?: GameScreenshot[];
}
