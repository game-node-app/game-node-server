import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { GameStatistics } from "../statistics-game/entity/game-statistics.entity";
import { ActivityStatistics } from "./activity-statistics.entity";

/**
 * While it's called UserView, it also contains anonymous views (userId is set to null).
 */
@Entity()
export class UserView {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    @Index()
    userId?: string;

    @ManyToOne(() => GameStatistics, (gameStatistics) => gameStatistics.views)
    gameStatistics: GameStatistics;
    @ManyToOne(
        () => ActivityStatistics,
        (activityStatistics) => activityStatistics.views,
    )
    activityStatistics: ActivityStatistics;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
