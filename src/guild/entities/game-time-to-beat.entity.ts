import {
    Column,
    Entity,
    Index,
    JoinColumn,
    OneToOne,
    PrimaryColumn,
} from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";

/**
 * Locally cached IGDB `game_time_to_beats` row (design 4). Null seconds mean IGDB
 * has no entry for the game, negatively cached until `fetchedAt` goes stale.
 */
@Entity()
@Index("IDX_game_ttb_normally", ["normallySeconds"])
export class GameTimeToBeat {
    @PrimaryColumn({ type: "bigint" })
    gameId: number;

    @OneToOne(() => Game, { nullable: false, onDelete: "CASCADE" })
    @JoinColumn({
        name: "gameId",
        foreignKeyConstraintName: "FK_game_time_to_beat_game",
    })
    game: Game;

    @Column({ type: "int", unsigned: true, nullable: true, default: null })
    hastilySeconds: number | null;

    @Column({ type: "int", unsigned: true, nullable: true, default: null })
    normallySeconds: number | null;

    @Column({ type: "int", unsigned: true, nullable: true, default: null })
    completelySeconds: number | null;

    @Column({ type: "int", unsigned: true, default: 0 })
    submitCount: number;

    @Column({ type: "datetime" })
    fetchedAt: Date;
}
