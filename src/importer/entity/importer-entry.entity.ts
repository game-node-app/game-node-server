import {
    Column,
    CreateDateColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { GameExternalGame } from "../../game/external-game/entity/game-external-game.entity";
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
        onDelete: "CASCADE",
    })
    library: Library;
    @Column({
        nullable: false,
    })
    libraryUserId: string;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
