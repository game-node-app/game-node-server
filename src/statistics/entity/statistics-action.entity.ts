import {
    Column,
    CreateDateColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { GameStatistics } from "./game-statistics.entity";
import { ReviewStatistics } from "./review-statistics.entity";
import { ActivityStatistics } from "./activity-statistics.entity";
import { CommentStatistics } from "./comment-statistics.entity";
import { PostStatistics } from "./post-statistics.entity";

export class StatisticsAction {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => GameStatistics, {
        onDelete: "CASCADE",
        nullable: true,
    })
    gameStatistics: GameStatistics | null;
    @Column({
        nullable: true,
    })
    gameStatisticsId: number | null;
    @ManyToOne(() => ReviewStatistics, {
        onDelete: "CASCADE",
        nullable: true,
    })
    reviewStatistics: ReviewStatistics | null;
    @Column({
        nullable: true,
    })
    reviewStatisticsId: number | null;
    @ManyToOne(() => ActivityStatistics, {
        onDelete: "CASCADE",
        nullable: true,
    })
    activityStatistics: ActivityStatistics | null;
    @Column({
        nullable: true,
    })
    activityStatisticsId: number | null;
    @ManyToOne(() => CommentStatistics, {
        onDelete: "CASCADE",
        nullable: true,
    })
    commentStatistics: CommentStatistics | null;
    @Column({
        nullable: true,
    })
    commentStatisticsId: number | null;

    @ManyToOne(() => PostStatistics, {
        onDelete: "CASCADE",
        nullable: true,
    })
    postStatistics: PostStatistics;
    @Column({
        nullable: true,
    })
    postStatisticsId: number | null;
    @CreateDateColumn({
        type: "timestamp",
    })
    createdAt: Date;
    @UpdateDateColumn({
        type: "timestamp",
    })
    updatedAt: Date;
}
