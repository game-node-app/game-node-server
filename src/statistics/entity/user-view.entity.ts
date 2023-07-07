import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { GameStatistics } from "./game-statistics.entity";
import { ReviewStatistics } from "./review-statistics.entity";

/**
 * While it's called UserView, it also contains anonymous views (userId is set to null).
 * This table will allow us to keep track of what games are being viewed by a user,
 * and may be used in a possible future feature.
 */
@Entity()
export class UserView {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    userId: string;

    @ManyToOne(() => GameStatistics, (gameStatistics) => gameStatistics.views)
    gameStatistics: GameStatistics;
}
