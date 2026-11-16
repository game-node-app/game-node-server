import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { BaseEntity } from "../../utils/db/base.entity";
import { YearRecap } from "./year-recap.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { GamePlatform } from "../../game/game-repository/entities/game-platform.entity";

@Entity()
export class YearRecapPlayedGame extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => YearRecap, (recap) => recap.playedGames, {
        onDelete: "CASCADE",
    })
    recap: YearRecap;
    @Column({
        nullable: false,
    })
    recapId: number;
    @ManyToOne(() => Game)
    game: Game;
    @Column({
        nullable: false,
    })
    gameId: number;
    @ManyToOne(() => GamePlatform, {
        nullable: false,
    })
    platform: GamePlatform;
    @Column({
        nullable: false,
    })
    platformId: number;
    /**
     * Total playtime registered for the game during the recap period, in seconds
     */
    @Column({
        nullable: false,
        default: 0,
    })
    totalPlaytimeSeconds: number;
    @Column({
        nullable: false,
        default: 0,
        type: "float",
    })
    percentOfTotalPlaytime: number;
    @Column({
        nullable: false,
        type: "varchar",
        default: "0.00",
    })
    percentOfTotalPlaytimeFormatted: string;
    /**
     * First day the game was played in the year; falls back to the library start date.
     */
    @Column({ type: "date", nullable: true })
    firstPlayedAt: string | null;
    /**
     * Day the game was finished in the year, if any.
     */
    @Column({ type: "datetime", nullable: true })
    finishedAt: Date | null;
    /**
     * The user's review rating (0-5), if any.
     */
    @Column({ type: "float", nullable: true })
    rating: number | null;
}
