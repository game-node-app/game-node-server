import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { DailyPuzzle } from "./daily-puzzle.entity";
import { DailyStatus } from "../daily.constants";

@Entity()
@Unique("UQ_daily_result_user_puzzle", ["userId", "puzzleId"])
export class DailyResult {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({ type: "varchar", length: 36 })
    userId: string;
    @ManyToOne(() => Profile, { onDelete: "CASCADE" })
    @JoinColumn({
        name: "userId",
        foreignKeyConstraintName: "FK_daily_result_profile",
    })
    profile: Profile;
    @Column({ type: "int" })
    puzzleId: number;
    @ManyToOne(() => DailyPuzzle, { onDelete: "CASCADE" })
    @JoinColumn({
        name: "puzzleId",
        foreignKeyConstraintName: "FK_daily_result_puzzle",
    })
    puzzle: DailyPuzzle;
    /** Guessed game ids in order, `null` for a skip. */
    @Column({ type: "json" })
    guesses: (number | null)[];
    /** Specs only: how many guesses existed when the hint was used. */
    @Column({ type: "int", nullable: true })
    hintAt: number | null;
    @Column({ type: "varchar", length: 16 })
    status: DailyStatus;
    @Column({ type: "int" })
    attempts: number;
    @Column({ type: "datetime", nullable: true })
    finishedAt: Date | null;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
