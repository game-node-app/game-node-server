import { Column, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { GameExternalGame } from "../../game/game-repository/entities/game-external-game.entity";
import { Library } from "../../libraries/entities/library.entity";

export abstract class ImporterEntry {
    @PrimaryGeneratedColumn()
    id: number;
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
