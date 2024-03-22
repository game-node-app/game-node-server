import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { Statistics } from "./statistics.entity";
import { GameStatistics } from "./game-statistics.entity";
import { ReviewStatistics } from "./review-statistics.entity";

/**
 * While it's called UserView, it also contains anonymous views (profile is set to null).
 */
@Entity()
export class UserView {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => Profile, {
        nullable: true,
        onDelete: "CASCADE",
    })
    profile?: Profile;
    @Column({
        nullable: true,
    })
    profileUserId: string | null;
    @CreateDateColumn({
        type: "timestamp",
    })
    @Index()
    createdAt: Date;
    @UpdateDateColumn({
        type: "timestamp",
    })
    updatedAt: Date;
    @ManyToOne(() => GameStatistics, (gs) => gs.views, {
        onDelete: "CASCADE",
        nullable: true,
    })
    gameStatistics: GameStatistics | null;
    @ManyToOne(() => ReviewStatistics, (rs) => rs.views, {
        onDelete: "CASCADE",
        nullable: true,
    })
    reviewStatistics: ReviewStatistics | null;
}
