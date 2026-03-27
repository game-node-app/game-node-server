import {
    Column,
    Entity,
    JoinTable,
    ManyToMany,
    ManyToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { BaseEntity } from "../../../utils/db/base.entity";
import { ObtainedGameAchievement } from "./obtained-game-achievement.entity";
import { Profile } from "../../../profile/entities/profile.entity";
import { GameExternalGame } from "../../external-game/entity/game-external-game.entity";

@Entity()
export class ObtainedGameAchievementActivity extends BaseEntity {
    @PrimaryGeneratedColumn()
    id: number;
    @ManyToOne(() => Profile, {
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({
        nullable: false,
    })
    profileUserId: string;
    @Column({
        nullable: false,
        default: 0,
    })
    totalObtained: number;
    /**
     * If the user has obtained all achievements for the game
     * (including obtained achievements not related to this specific activity), this is set to true.
     * This value may be outdated if a game update/DLC adds new achievements, but
     * for activity purposes it is sufficient.
     */
    @Column({
        nullable: false,
        default: false,
    })
    hasCompletedAllAchievements: boolean;
    /**
     * Exclusive to PlayStation games: if the user has obtained the platinum trophy for the game
     * This will only be true if the platinum trophy is featured in the list of obtained achievements
     * for this specific activity.
     */
    @Column({
        nullable: false,
        default: false,
    })
    hasObtainedPlatinumTrophy: boolean;
    /**
     * The related external game the achievements were obtained for.
     * All obtained achievements for this activity should be related to this specific external game, but this is not enforced on the database level.
     */
    @ManyToOne(() => GameExternalGame, {
        nullable: false,
    })
    externalGame: GameExternalGame;
    @Column({
        nullable: false,
    })
    externalGameId: number;
    /**
     * Game achievements obtained by the user for this activity.
     * This reads as 'achievements obtained since last check' and usually only includes
     * one or more achievements for related to a single game, since processing is done on a per-game basis.
     * @see GameAcheivementSyncProcessor
     */
    @ManyToMany(() => ObtainedGameAchievement, {
        onDelete: "CASCADE",
        cascade: true,
    })
    @JoinTable({
        name: "obtained_game_achievement_activity_obtained_game_achievement",
    })
    obtainedGameAchievements: ObtainedGameAchievement[];
}
