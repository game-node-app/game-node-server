import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Profile } from "../../profile/entities/profile.entity";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications.constants";
import { Review } from "../../reviews/entities/review.entity";
import { Game } from "../../game/game-repository/entities/game.entity";
import { Activity } from "../../activities/activities-repository/entities/activity.entity";

@Entity()
export class Notification {
    @PrimaryGeneratedColumn()
    id: number;
    @Column({
        nullable: false,
    })
    sourceType: ENotificationSourceType;
    /**
     * What this notification's about. E.g.: a new like, a new follower, a game launch, etc.
     */
    @Column({
        nullable: false,
    })
    category: ENotificationCategory;
    @ManyToOne(() => Review, {
        nullable: true,
        onDelete: "CASCADE",
    })
    review: Review | null;
    @Column({
        nullable: true,
    })
    reviewId: string | null;
    @ManyToOne(() => Game, {
        nullable: true,
        onDelete: "CASCADE",
    })
    game: Game | null;
    @Column({
        nullable: true,
    })
    gameId: number | null;
    @ManyToOne(() => Activity, {
        nullable: true,
        onDelete: "CASCADE",
    })
    activity: Activity | null;
    @Column({
        nullable: true,
    })
    activityId: string | null;
    /**
     * User responsible for generating this notification (e.g. user that liked a review).
     */
    @ManyToOne(() => Profile, {
        nullable: true,
        onDelete: "CASCADE",
    })
    profile: Profile | null;
    /**
     * User responsible for generating this notification (e.g. user that liked a review).
     * When null/undefined, the notification was generated by the 'system'.
     */
    @Column({
        nullable: true,
    })
    profileUserId: string | null;

    @Column({
        default: false,
    })
    isViewed: boolean;
    /**
     * User which is the target for this notification. <br>
     * If this is empty (null/undefined), the notification is targeted at all users. <br>
     * Not to be confused with the 'profile' property.
     */
    @ManyToOne(() => Profile, {
        nullable: true,
        onDelete: "CASCADE",
    })
    targetProfile: Profile | null;
    /**
     * User which is the target for this notification. <br>
     * If this is empty (null/undefined), the notification is targeted at all users. <br>
     * Not to be confused with the 'profile' property.
     */
    @Column({
        nullable: true,
    })
    targetProfileUserId: string | null;
    @CreateDateColumn({
        type: "timestamp",
    })
    createdAt: Date;
    @UpdateDateColumn({
        type: "timestamp",
    })
    updatedAt: Date;
}
