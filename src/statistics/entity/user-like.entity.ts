import {
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
    Column,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { GameStatistics } from "./game-statistics.entity";
import { ReviewStatistics } from "./review-statistics.entity";
import { ActivityStatistics } from "./activity-statistics.entity";

@Entity()
@Unique(["profile", "gameStatistics"])
@Unique(["profile", "reviewStatistics"])
export class UserLike {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;
    @CreateDateColumn({
        type: "timestamp",
    })
    @Index()
    createdAt: Date;
    @UpdateDateColumn({
        type: "timestamp",
    })
    updatedAt: Date;
    @ManyToOne(() => GameStatistics, (gs) => gs.likes, {
        onDelete: "CASCADE",
        nullable: true,
    })
    gameStatistics: GameStatistics | null;
    @Column({
        nullable: true,
    })
    gameStatisticsId: number | null;
    @ManyToOne(() => ReviewStatistics, (rs) => rs.likes, {
        onDelete: "CASCADE",
        nullable: true,
    })
    reviewStatistics: ReviewStatistics | null;
    @Column({
        nullable: true,
    })
    reviewStatisticsId: number | null;
    @ManyToOne(() => ActivityStatistics, (as) => as.likes, {
        onDelete: "CASCADE",
        nullable: true,
    })
    activityStatistics: ActivityStatistics | null;
    @Column({
        nullable: true,
    })
    activityStatisticsId: number | null;
}
