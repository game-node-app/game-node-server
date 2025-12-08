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
}
