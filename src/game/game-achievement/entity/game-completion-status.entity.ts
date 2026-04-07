import { Column, Entity, ManyToOne, PrimaryColumn } from "typeorm";
import { Game } from "../../game-repository/entities/game.entity";
import { Profile } from "../../../profile/entities/profile.entity";

/**
 * Entity representing the completion status of a game for a specific user.
 * It tracks whether the game is completed, if the platinum trophy is obtained, and the total/obtained achievements.
 * @see GameAchievementSyncModule
 */
@Entity()
export class GameCompletionStatus {
    @PrimaryColumn()
    gameId: number;
    @PrimaryColumn()
    profileUserId: string;
    @ManyToOne(() => Game, {
        onDelete: "CASCADE",
        nullable: false,
    })
    game: Game;
    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
        nullable: false,
    })
    profile: Profile;

    @Column({ type: "boolean", default: false })
    isCompleted: boolean;

    /**
     * Exclusive to PlayStation games.
     * Indicates whether the platinum trophy has been obtained for the game.
     * This is often a key indicator of 100% completion in many games.
     */
    @Column({ type: "boolean", default: false })
    isPlatinumObtained: boolean;

    @Column({ nullable: false, default: 0 })
    totalAvailableAchievements: number;

    @Column({ nullable: false, default: 0 })
    totalObtainedAchievements: number;

    @Column({ type: "timestamp", nullable: true })
    completedAt: Date | null;

    @Column({ type: "timestamp", nullable: true })
    platinumObtainedAt: Date | null;
}
