import { BaseEntity } from "../../../utils/db/base.entity";
import {
    Column,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from "typeorm";

import { Profile } from "../../../profile/entities/profile.entity";
import { GameExternalGame } from "../../external-game/entity/game-external-game.entity";

/**
 * Entity representing an achievement obtained by a user in a specific game.
 * 'platform' info can be obtained by querying the game's available achievements, and associating
 * the external ids (externalAchievementId).
 */
@Entity()
@Unique(["profile", "externalGame", "externalAchievementId"])
@Index(["profile", "externalGame"])
export class ObtainedGameAchievement extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * The ID of the achievement in the external platform (e.g., Steam achievement ID).
     * Normalized to a string to accommodate various formats across platforms.
     */
    @Column({
        nullable: false,
    })
    externalAchievementId: string;
    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;
    @ManyToOne(() => GameExternalGame, {
        nullable: false,
    })
    externalGame: GameExternalGame;
    @Column({
        nullable: false,
    })
    externalGameId: number;
    @Column({
        nullable: false,
    })
    obtainedAt: Date;
}
