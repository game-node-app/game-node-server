import { UserComment } from "./user-comment.entity";
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from "typeorm";
import { Review } from "../../reviews/entities/review.entity";
import { ThreadEnabledComment } from "../comment.types";
import { StatisticsTarget } from "../../statistics/entity/statistics-target.entity";

@Entity()
@Index(["profile", "review"])
@Index("UQ_review_comment_statistics_target", ["statisticsTargetId"], { unique: true })
export class ReviewComment
    extends UserComment
    implements ThreadEnabledComment<ReviewComment>
{
    @ManyToOne(() => Review, {
        nullable: false,
        onDelete: "CASCADE",
    })
    review: Review;
    @Column({
        nullable: false,
    })
    reviewId: string;

    @OneToOne(() => StatisticsTarget, { nullable: true, onDelete: "RESTRICT" })
    @JoinColumn({ name: "statisticsTargetId" })
    statisticsTarget: StatisticsTarget | null;
    @Column({ type: "bigint", unsigned: true, nullable: true })
    statisticsTargetId: number | null;

    @OneToMany(() => ReviewComment, (comment) => comment.childOf)
    parentOf: ReviewComment[] | null;

    @ManyToOne(() => ReviewComment, {
        nullable: true,
        onDelete: "CASCADE",
    })
    childOf: ReviewComment[] | null;
    @Column({
        nullable: true,
    })
    childOfId: string | null;
}
