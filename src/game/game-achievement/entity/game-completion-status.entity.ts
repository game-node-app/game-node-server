import { Column, Entity, ManyToOne, PrimaryColumn } from "typeorm";
import { Game } from "../../game-repository/entities/game.entity";
import { Profile } from "../../../profile/entities/profile.entity";
import { GameExternalGame } from "../../external-game/entity/game-external-game.entity";
import { BaseEntity } from "../../../utils/db/base.entity";

/**
 * Entity representing the completion status of a game for a specific user.
 * It tracks whether the game is completed, if the platinum trophy is obtained, and the total/obtained achievements.
 * @see GameAchievementSyncModule
 */
@Entity()
export class GameCompletionStatus extends BaseEntity {
    @PrimaryColumn()
    externalGameId: number;
    @PrimaryColumn()
    profileUserId: string;
    @ManyToOne(() => GameExternalGame, {
        nullable: false,
    })
    externalGame: GameExternalGame;
    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
        nullable: false,
    })
    profile: Profile;
    @Column({ nullable: false, default: false })
    isCompleted: boolean;
    /**
     * Exclusive to PlayStation games.
     * Indicates whether the platinum trophy has been obtained for the game.
     * This is often a key indicator of 100% completion in many games.
     */
    @Column({ nullable: false, default: false })
    isPlatinumObtained: boolean;

    @Column({ nullable: false, default: 0 })
    totalAvailableAchievements: number;

    @Column({ nullable: false, default: 0 })
    totalObtainedAchievements: number;

    @Column({ type: "timestamp", nullable: true })
    completedAt: Date | null;

    @Column()
    checksum: string;
}
