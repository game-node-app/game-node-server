import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from "typeorm";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Profile } from "../../profile/entities/profile.entity";
import { DailyMode, DailyStatus } from "../daily.constants";
import { DailyPuzzleMeta } from "./daily-puzzle.entity";

/** One playable practice round; the id is the capability for guest rounds. */
@Entity("daily_practice_round")
export class DailyPracticeRound {
    @PrimaryColumn({ type: "char", length: 36 })
    id: string;
    @Column({ type: "varchar", length: 36, nullable: true })
    userId: string | null;
    @ManyToOne(() => Profile, { nullable: true, onDelete: "CASCADE" })
    @JoinColumn({
        name: "userId",
        foreignKeyConstraintName: "FK_daily_practice_round_profile",
    })
    profile: Profile | null;
    @Column({ type: "varchar", length: 16 })
    mode: DailyMode;
    @ManyToOne(() => Game, { nullable: false })
    @JoinColumn({
        name: "gameId",
        foreignKeyConstraintName: "FK_daily_practice_round_game",
    })
    game: Game;
    @Column({ type: "bigint" })
    gameId: number;
    @Column({ type: "json" })
    meta: DailyPuzzleMeta;
    @Column({ type: "json" })
    guesses: (number | null)[];
    /** Specs only: how many guesses existed when the hint was used. */
    @Column({ type: "int", nullable: true })
    hintAt: number | null;
    @Column({ type: "varchar", length: 16 })
    status: DailyStatus;
    @Column({ type: "int" })
    attempts: number;
    @Index("IDX_daily_practice_round_createdAt")
    @CreateDateColumn()
    createdAt: Date;
    @Column({ type: "datetime", nullable: true })
    finishedAt: Date | null;
}
