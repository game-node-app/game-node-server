import {
    Column,
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToMany,
    OneToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { GameAlternativeName } from "./game-alternative-name.entity";
import { GameArtwork } from "./game-artwork.entity";
import { EGameCategory, EGameStatus } from "../game-repository.constants";
import { GameCollection } from "./game-collection.entity";
import { GameCover } from "./game-cover.entity";
import { GameScreenshot } from "./game-screenshot.entity";
import { GameExternalGame } from "./game-external-game.entity";
import { GameFranchise } from "./game-franchise.entity";
import { GameLocalization } from "./game-localization.entity";
import { GameMode } from "./game-mode.entity";
import { GameGenre } from "./game-genre.entity";
import { GameKeyword } from "./game-keyword.entity";
import { GamePlatform } from "./game-platform.entity";

/**
 * For future maintainers:
 * I've tried to work my way with this using cascades, but it didn't work:
 * There's a bug in the .save() method for entities that have OneToMany relationships:
 * https://github.com/typeorm/typeorm/issues/3095
 * The issue is open since 2018, so it will probably never be fixed.
 * I just saved you from 4 hours of debugging, you're welcome ;)
 *
 * TL;DR: Do not use .save() for this or related entities.
 * */

/**
 * TODO
 * Pending relationships (these have lots of deeply nested child relationships):
 * - game_engines
 * - involved_companies
 * - language_supports
 */

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
    // URL-safe, unique name.
    @Column()
    slug: string;
    @Column("double", {
        nullable: true,
    })
    aggregatedRating?: number;
    @Column("int", {
        nullable: true,
    })
    aggregatedRatingCount?: number;
    @Column({
        default: EGameCategory.Main,
    })
    category: EGameCategory;
    @Column({
        default: EGameStatus.Released,
    })
    status: EGameStatus;
    @Column("text", {
        nullable: true,
    })
    summary: string;
    @Column("varchar", {
        nullable: true,
    })
    checksum: string;
    @Column({
        nullable: true,
    })
    url: string;
    @Column({
        nullable: true,
        type: "timestamp",
    })
    firstReleaseDate: Date;
    @CreateDateColumn({
        type: "bigint",
    })
    createdAt: Date;
    @UpdateDateColumn({
        type: "timestamp",
    })
    updatedAt: Date;

    // **Self-referencing relationships**
    // These are usually the most difficult to handle.
    @OneToMany(() => Game, (game) => game.dlcOf, {
        nullable: true,
    })
    dlcs?: Game[];
    // Equivalent to parent_game, for dlcs
    @ManyToOne(() => Game, (game) => game.dlcs, {
        nullable: true,
    })
    dlcOf?: Game;
    @OneToMany(() => Game, (game) => game.expansionOf, {
        nullable: true,
    })
    expansions?: Game[];
    // Equivalent to parent_game, for expansions
    @ManyToOne(() => Game, (game) => game.expansions, {
        nullable: true,
    })
    expansionOf?: Game;
    @OneToMany(() => Game, (game) => game.expandedGameOf, {
        nullable: true,
    })
    expandedGames?: Game[];
    // Equivalent to parent_game, for expanded games.
    @ManyToOne(() => Game, (game) => game.expandedGames, {
        nullable: true,
    })
    expandedGameOf?: Game;
    @OneToMany(() => Game, (game) => game.similarGameOf, {
        nullable: true,
    })
    similarGames?: Game[];
    // Equivalent to parent_game, for similar games.
    @ManyToOne(() => Game, (game) => game.similarGames, {
        nullable: true,
    })
    similarGameOf?: Game;

    // **Relationships**

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

    @OneToMany(
        () => GameLocalization,
        (gameLocalization) => gameLocalization.game,
        {
            nullable: true,
        },
    )
    localizations?: GameLocalization[];
    @OneToMany(() => GameMode, (gameMode) => gameMode.game, {
        nullable: true,
    })
    gameModes?: GameMode[];
    @OneToMany(() => GameGenre, (gameGenre) => gameGenre.game, {
        nullable: true,
    })
    genres?: GameGenre[];
    @ManyToMany(() => GameKeyword, (gameKeyword) => gameKeyword.game, {
        nullable: true,
    })
    @JoinTable()
    keywords?: GameKeyword[];
    @ManyToMany(() => GameFranchise, (gameFranchise) => gameFranchise.games, {
        nullable: true,
    })
    @JoinTable()
    franchises?: GameFranchise[];
    @ManyToMany(() => GamePlatform, (gamePlatform) => gamePlatform.games, {
        nullable: true,
    })
    platforms?: GamePlatform[];
    @ManyToMany(
        () => GameExternalGame,
        (gameExternalGame) => gameExternalGame.games,
        {
            nullable: true,
        },
    )
    externalGames?: GameExternalGame[];
}
