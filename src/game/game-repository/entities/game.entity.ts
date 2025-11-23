import {
    Column,
    CreateDateColumn,
    Entity,
    JoinTable,
    ManyToMany,
    OneToMany,
    OneToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import { GameAlternativeName } from "./game-alternative-name.entity";
import { GameArtwork } from "./game-artwork.entity";
import {
    EGameCategory,
    EGameStatus,
    EGameStorageSource,
} from "../game-repository.constants";
import { GameCover } from "./game-cover.entity";
import { GameScreenshot } from "./game-screenshot.entity";
import { GameExternalGame } from "../../external-game/entity/game-external-game.entity";
import { GameFranchise } from "./game-franchise.entity";
import { GameLocalization } from "./game-localization.entity";
import { GameMode } from "./game-mode.entity";
import { GameGenre } from "./game-genre.entity";
import { GameKeyword } from "./game-keyword.entity";
import { GamePlatform } from "./game-platform.entity";
import { GameInvolvedCompany } from "./game-involved-company.entity";
import { GameTheme } from "./game-theme.entity";
import { GamePlayerPerspective } from "./game-player-perspective.entity";
import { GameEngine } from "./game-engine.entity";

/**
 * For future maintainers:
 * I've tried to work my way with this using cascades, but it didn't work:
 * There's a bug in the .save() method for models that have OneToMany relationships:
 * https://github.com/typeorm/typeorm/issues/3095
 * The issue is open since 2018, so it will probably never be fixed.
 * I just saved you from 4 hours of debugging, you're welcome ;)
 *
 * TL;DR: Do not use .save() for this or related models.
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
    @Column("text", {
        nullable: true,
    })
    storyline: string;
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
        type: "datetime",
    })
    firstReleaseDate: Date;
    @CreateDateColumn({
        type: "datetime",
    })
    createdAt: Date;
    @UpdateDateColumn({
        type: "datetime",
    })
    updatedAt: Date;

    //
    // **Self-referencing relationships**
    //

    @ManyToMany(() => Game, (game) => game.dlcOf, {
        nullable: true,
    })
    @JoinTable()
    dlcs: Game[];
    @ManyToMany(() => Game, (game) => game.dlcs, {
        nullable: true,
    })
    dlcOf: Game[];

    @ManyToMany(() => Game, (game) => game.expansionOf, {
        nullable: true,
    })
    @JoinTable()
    expansions: Game[];
    @ManyToMany(() => Game, (game) => game.expansions, {
        nullable: true,
    })
    expansionOf: Game[];

    @ManyToMany(() => Game, (game) => game.expandedGameOf, {
        nullable: true,
    })
    @JoinTable()
    expandedGames: Game[];
    @ManyToMany(() => Game, (game) => game.expandedGames, {
        nullable: true,
    })
    expandedGameOf: Game[];
    @ManyToMany(() => Game, (game) => game.similarGameOf, {
        nullable: true,
    })
    @JoinTable()
    similarGames: Game[];
    @ManyToMany(() => Game, (game) => game.similarGames, {
        nullable: true,
    })
    similarGameOf: Game[];
    @ManyToMany(() => Game, (game) => game.remakeOf, {
        nullable: true,
    })
    @JoinTable()
    remakes: Game[];
    @ManyToMany(() => Game, (game) => game.remakes)
    remakeOf: Game[];
    @ManyToMany(() => Game, (game) => game.remasterOf)
    @JoinTable()
    remasters: Game[];
    @ManyToMany(() => Game, (game) => game.remasters)
    remasterOf: Game[];
    //
    // **Relationships**
    //

    @OneToOne(() => GameCover, (cover) => cover.game, {
        nullable: true,
    })
    cover: GameCover;
    @OneToMany(
        () => GameAlternativeName,
        (gameAlternativeName) => gameAlternativeName.game,
        {
            nullable: true,
        },
    )
    alternativeNames: GameAlternativeName[];
    @OneToMany(() => GameArtwork, (gameArtwork) => gameArtwork.game, {
        nullable: true,
    })
    artworks: GameArtwork[];
    @OneToMany(() => GameScreenshot, (gameScreenshot) => gameScreenshot.game, {
        nullable: true,
    })
    screenshots: GameScreenshot[];

    @OneToMany(
        () => GameLocalization,
        (gameLocalization) => gameLocalization.game,
        {
            nullable: true,
        },
    )
    gameLocalizations: GameLocalization[];
    @ManyToMany(() => GameMode, (gameMode) => gameMode.game, {
        nullable: true,
    })
    @JoinTable()
    gameModes: GameMode[];
    @ManyToMany(() => GameGenre, (gameGenre) => gameGenre.games, {
        nullable: true,
    })
    @JoinTable()
    genres: GameGenre[];
    @ManyToMany(() => GameTheme, (gameTheme) => gameTheme.games)
    @JoinTable()
    themes: GameTheme[];

    @ManyToMany(() => GamePlayerPerspective, (perspective) => perspective.games)
    @JoinTable()
    playerPerspectives: GamePlayerPerspective[];
    @ManyToMany(() => GameEngine, (engine) => engine.games)
    @JoinTable()
    gameEngines: GameEngine[];

    @ManyToMany(() => GameKeyword, (gameKeyword) => gameKeyword.game, {
        nullable: true,
    })
    @JoinTable()
    keywords: GameKeyword[];
    @ManyToMany(() => GameFranchise, (gameFranchise) => gameFranchise.games, {
        nullable: true,
    })
    @JoinTable()
    franchises: GameFranchise[];
    @ManyToMany(() => GamePlatform, (gamePlatform) => gamePlatform.games, {
        nullable: true,
    })
    platforms: GamePlatform[];
    @OneToMany(
        () => GameExternalGame,
        (gameExternalGame) => gameExternalGame.game,
        {
            nullable: true,
        },
    )
    externalGames: GameExternalGame[];
    @ManyToMany(
        () => GameInvolvedCompany,
        (involvedCompany) => involvedCompany.games,
    )
    @JoinTable()
    involvedCompanies: GameInvolvedCompany[];
    /**
     * Oh dear maintainer, please forgive me for using transient fields.
     */
    source = EGameStorageSource.MYSQL;
}
