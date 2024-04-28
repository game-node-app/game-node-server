import {
    Column,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";
import { GameExternalGame } from "../../game/game-repository/entities/game-external-game.entity";
import { Library } from "../../libraries/entities/library.entity";
import { EGameExternalGameCategory } from "../../game/game-repository/game-repository.constants";

/**
 * Table representing external games which have been 'ignored' by the user, and thus
 * won't trigger new notifications when checking for updates on their library.
 */
@Entity()
@Unique(["game", "gameExternalGame", "library"])
export class ImporterIgnoredEntry {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Column({
        nullable: false,
    })
    gameId: number;
    /**
     * Object representing this game in an external store (e.g. Steam)
     */
    @ManyToOne(() => GameExternalGame, {
        nullable: true,
    })
    gameExternalGame: GameExternalGame;
    @Column({
        nullable: true,
    })
    gameExternalGameId: number;
    @ManyToOne(() => Library, {
        nullable: false,
    })
    library: Library;
    @Column({
        nullable: false,
    })
    libraryUserId: string;
    @Column({
        nullable: false,
    })
    source: EGameExternalGameCategory;
}
