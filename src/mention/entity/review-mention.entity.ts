import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { Review } from "../../reviews/entities/review.entity";
import { Profile } from "../../profile/entities/profile.entity";

/**
 * Entity representing a mention of another user in a review. <br>
 * Mainly used by the notification system.
 */
@Entity()
@Unique(["reviewId", "mentionedProfileUserId"])
export class ReviewMention {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Review, {
        nullable: false,
        onDelete: "CASCADE",
    })
    review: Review;

    @Column()
    reviewId: string;

    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    mentionedProfile: Profile;

    @Column()
    mentionedProfileUserId: string;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
