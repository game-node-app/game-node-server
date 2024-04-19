import {
    Column,
    CreateDateColumn,
    Entity,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
    UpdateDateColumn,
} from "typeorm";
import { ActivityType } from "../../activities-queue/activities-queue.constants";
import { Profile } from "../../../profile/entities/profile.entity";
import { CollectionEntry } from "../../../collections/collections-entries/entities/collection-entry.entity";
import { Review } from "../../../reviews/entities/review.entity";
import { UserFollow } from "../../../follow/entity/user-follow.entity";
import { Collection } from "../../../collections/entities/collection.entity";

@Entity()
@Unique(["profile", "collectionEntry", "collection"])
@Unique(["profile", "userFollow"])
@Unique(["profile", "review"])
export class Activity {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    @Column({
        nullable: false,
    })
    type: ActivityType;
    /**
     * The associated profile with this Activity (e.g. user who performed an action)
     */
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column({ nullable: false })
    profileUserId: string;
    @ManyToOne(() => CollectionEntry, {
        nullable: true,
        onDelete: "CASCADE",
    })
    collectionEntry: CollectionEntry | null;
    @Column({
        nullable: true,
    })
    collectionEntryId: string | null;
    @ManyToOne(() => Collection, {
        nullable: true,
        onDelete: "CASCADE",
    })
    collection: Collection | null;
    @Column({
        nullable: true,
    })
    collectionId: string | null;
    @ManyToOne(() => Review, {
        nullable: true,
        onDelete: "CASCADE",
    })
    review: Review | null;
    @Column({
        nullable: true,
    })
    reviewId: string | null;
    @ManyToOne(() => UserFollow, {
        nullable: true,
        onDelete: "CASCADE",
    })
    userFollow: UserFollow | null;
    @Column({
        nullable: true,
    })
    userFollowId: number | null;
    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
