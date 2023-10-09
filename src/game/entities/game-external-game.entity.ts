import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryColumn,
    UpdateDateColumn,
} from "typeorm";
import {
    EGameExternalGameCategory,
    EGameExternalGameMedia,
} from "../game.constants";
import { Game } from "./game.entity";
import { GamePlatform } from "./game-platform.entity";

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
    @Column()
    category: EGameExternalGameCategory;
    @Column()
    media: EGameExternalGameMedia;
    @Column("text")
    checksum: string;
    @Column("text")
    name: string;
    @Column("text")
    url: string;
    @Column("int")
    year: number;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;

    // Relationships
    // TODO: add Platform relationship
    @ManyToOne(() => Game, (game) => game.externalGames, {})
    game: Game;

    @ManyToOne(() => GamePlatform, {})
    platform: GamePlatform;
}
