import {
    Entity,
    Column,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    JoinColumn,
    JoinTable,
} from "typeorm";
import { GameStatistics } from "../statistics-game/entity/game-statistics.entity";
import { ReviewStatistics } from "./review-statistics.entity";
import { ActivityStatistics } from "./activity-statistics.entity";

@Entity()
@Unique(["userId", "gameStatistics"])
@Unique(["userId", "reviewStatistics"])
@Unique(["userId", "activityStatistics"])
export class UserLike {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column()
    userId: string;
    @ManyToOne(() => GameStatistics, (gameStatistics) => gameStatistics.likes)
    gameStatistics: GameStatistics;
    @ManyToOne(
        () => ReviewStatistics,
        (reviewStatistics) => reviewStatistics.likes,
    )
    reviewStatistics: ReviewStatistics;
    @ManyToOne(
        () => ActivityStatistics,
        (activityStatistics) => activityStatistics.likes,
    )
    activityStatistics: ActivityStatistics;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
