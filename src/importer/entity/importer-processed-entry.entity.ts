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

/**
 * Table to keep track of external games which have already been imported.
 */
@Entity()
@Unique(["game", "gameExternalGame", "profile"])
export class ImporterProcessedEntry {
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
}
