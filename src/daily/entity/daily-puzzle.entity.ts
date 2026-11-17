import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";
import { DailyMode, DailyPuzzleKind } from "../daily.constants";

export interface DailyPuzzleMeta {
    artworkId?: number;
    /** Shuffled once at generation: the order hints are revealed in. */
    keywordIds?: number[];
}

@Entity()
@Unique("UQ_daily_puzzle_kind_mode_date", ["kind", "mode", "date"])
@Unique("UQ_daily_puzzle_kind_mode_number", ["kind", "mode", "number"])
@Index("IDX_daily_puzzle_kind_date", ["kind", "date"])
export class DailyPuzzle {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({ type: "varchar", length: 16, default: "daily" })
    kind: DailyPuzzleKind;
    @Column({ type: "varchar", length: 16 })
    mode: DailyMode;
    /** Sequential per mode, the "#n" shown to players. */
    @Column({ type: "int" })
    number: number;
    /** "YYYY-MM-DD" in São Paulo. */
    @Column({ type: "date" })
    date: string;
    @ManyToOne(() => Game, { nullable: false })
    @JoinColumn({
        name: "gameId",
        foreignKeyConstraintName: "FK_daily_puzzle_game",
    })
    game: Game;
    @Column({ type: "bigint" })
    gameId: number;
    @Column({ type: "json" })
    meta: DailyPuzzleMeta;
    @Column({ type: "varchar", length: 16, default: "auto" })
    source: "auto" | "admin";
    @CreateDateColumn()
    createdAt: Date;
}
