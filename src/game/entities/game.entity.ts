import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToMany,
    OneToOne,
    PrimaryColumn,
} from "typeorm";
import { GameAlternativeName } from "./game-alternative-name.entity";
import { GameArtwork } from "./game-artwork.entity";
import { GameCategory } from "../game.constants";
import { GameCollection } from "./game-collection.entity";
import {Cover} from "./game-cover.entity";

/**
 * Dear maintainer, please adhere to the following rules when updating this file or it's related entities:
 * - When a game (this entity) is deleted, only entities which are exclusive to it should be deleted.
 * For example, when a game is deleted, its cover, artworks, screenshots, and alternative names should be deleted (cascade set to "true").
 * Every other field, such as the game's collection, should not be deleted.
 *
 * - When a game (this entity) is inserted or updated, all entities which are exclusive to it should be inserted or updated.
 * This usually means that you should set the cascade option to ["insert", "update"], so that TypeORM will first try to find and use
 * the "cascated" entity, and if it doesn't exist, it will insert it.
 * e.g.: When creating a game, if it's collection doesn't yet exist, it will be created.
 *
 * - You should also make sure that every field name is the same as the IGDB field name (but converted to camelcase).
 * e.g.: The IGDB field "first_release_date" should be mapped to the "firstReleaseDate" field. This also applies to relationships.
 *
 * */

/**
 * */
@Entity()
export class Game {
    /**
     * Should be mapped to the IGDB ID of the game.
     * */
    @PrimaryColumn("bigint")
    id: number;
    // Fields
    @Column("double")
    aggregatedRating: number;
    @Column("int")
    aggregatedRatingCount: number;
    @Column()
    category: GameCategory;
    @Column("text")
    checksum: string;
    /**
     * Originally a UNIX timestamp.
     * */
    @Column()
    createdAt: Date;

    // Relationships
    @OneToOne(() => Cover, (cover) => cover.game, {
        cascade: ["insert", "update"],
    })
    @JoinColumn()
    cover: Cover;
    @ManyToOne(() => GameCollection, (gameCollection) => gameCollection.games, {
        cascade: ["insert", "update"],
    })
    collection: GameCollection;
    @OneToMany(() => Game, (game) => game.bundles, {
        cascade: ["insert", "update"],
    })
    bundles: Game[];
    @OneToMany(
        () => GameAlternativeName,
        (gameAlternativeName) => gameAlternativeName.game,
        {
            cascade: true,
        },
    )
    alternativeNames: GameAlternativeName[];

    @OneToMany(() => GameArtwork, (gameArtwork) => gameArtwork.game, {
        cascade: true,
    })
    artworks: GameArtwork[];
    @OneToMany(() => Game, (game) => game.dlcs, {
        cascade: ["insert", "update"],
    })
    dlcs: Game[];
    @OneToMany(() => Game, (game) => game.expansions, {
        cascade: ["insert", "update"],
    })
    expansions: Game[];
}
