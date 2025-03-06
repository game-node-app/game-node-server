import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Review } from "../../reviews/entities/review.entity";
import { Profile } from "../../profile/entities/profile.entity";
import {
    ReportCategory,
    ReportHandleAction,
    ReportSourceType,
} from "../report.constants";
import { ReviewComment } from "../../comment/entity/review-comment.entity";
import { ActivityComment } from "../../comment/entity/activity-comment.entity";
import { Post } from "../../posts/entity/post.entity";
import { PostComment } from "../../comment/entity/post-comment.entity";

@Entity()
export class Report {
    @PrimaryGeneratedColumn()
    id: number;

    /**
     * Indexed to improve speed when filtering by type.
     */
    @Column({
        nullable: false,
    })
    @Index()
    sourceType: ReportSourceType;

    @Column({
        nullable: false,
    })
    category: ReportCategory;

    /**
     * User-submitted reason for report.
     */
    @Column({
        type: "longtext",
        nullable: true,
    })
    reason: string | null;

    /**
     * Profile that is being target of a report
     */
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    targetProfile: Profile;
    @Column({
        nullable: false,
    })
    targetProfileUserId: string;

    /**
     * User responsible for report.
     */
    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column()
    profileUserId: string;

    /**
     * User responsible for closing this report
     */
    @ManyToOne(() => Profile, {
        nullable: true,
        onDelete: "CASCADE",
    })
    closeProfile: Profile | null;
    @Column({
        nullable: true,
    })
    closeProfileUserId: string | null;

    // Relations
    @ManyToOne(() => Review, {
        nullable: true,
        onDelete: "SET NULL",
    })
    targetReview: Review | null;
    @Column({
        nullable: true,
    })
    targetReviewId: string | null;
    @ManyToOne(() => ReviewComment, {
        nullable: true,
        onDelete: "SET NULL",
    })
    targetReviewComment: ReviewComment | null;
    @Column({
        nullable: true,
    })
    targetReviewCommentId: string | null;

    @ManyToOne(() => ActivityComment, {
        nullable: true,
        onDelete: "SET NULL",
    })
    targetActivityComment: ActivityComment | null;
    @Column({
        nullable: true,
    })
    targetActivityCommentId: string | null;
    @ManyToOne(() => Post, { nullable: true, onDelete: "SET NULL" })
    targetPost: Post | null;
    @Column({
        nullable: true,
    })
    targetPostId: string | null;
    @ManyToOne(() => PostComment, { nullable: true, onDelete: "SET NULL" })
    targetPostComment: PostComment | null;
    @Column({
        nullable: true,
    })
    targetPostCommentId: string | null;

    @Column({
        nullable: false,
        default: false,
    })
    isClosed: boolean;

    /**
     * Action taken when closing this report
     */
    @Column({
        nullable: true,
        type: "varchar",
    })
    closeHandleAction: ReportHandleAction | null;

    @CreateDateColumn()
    createdAt: Date;
    @UpdateDateColumn()
    updatedAt: Date;
}
