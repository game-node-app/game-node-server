import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import { ENotificationCategory } from "../notifications.constants";
import { Review } from "../../reviews/entities/review.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";

@Entity()
export class Notification {
    @PrimaryGeneratedColumn()
    id: number;
    /**
     * What this notification's about. E.g.: a new like, a new follower, a game launch, etc.
     */
    @Column({
        nullable: false,
    })
    category: ENotificationCategory;
    @Column({
        nullable: false,
    })
    @ManyToOne(() => Review, {
        nullable: true,
    })
    review: Review | null;
    @Column({
        nullable: true,
    })
    reviewId: string | null;
    @ManyToOne(() => Game, {
        nullable: true,
    })
    game: Game | null;
    @Column({
        nullable: true,
    })
    gameId: number | null;
    @ManyToOne(() => Activity, {
        nullable: true,
    })
    activity: Activity | null;
    @Column({
        nullable: true,
    })
    activityId: string | null;
    @ManyToOne(() => Profile, {
        nullable: true,
    })
    profile: Profile;
    @Column({
        nullable: true,
    })
    profileUserId: string;

    @Column({
        default: false,
    })
    isViewed: boolean;
    /**
     * Target user profile/id. <br>
     * If this is empty (null/undefined), the notification is targeted at all users. <br>
     * Not to be confused with the 'profile' property.
     */
    @ManyToOne(() => Profile, {
        nullable: true,
    })
    targetProfile: Profile | null;
    /**
     * Target user profile/id. <br>
     * If this is empty (null/undefined), the notification is targeted at all users. <br>
     * Not to be confused with the 'profile' property.
     */
    @Column({
        nullable: true,
    })
    targetProfileUserId: string | null;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
