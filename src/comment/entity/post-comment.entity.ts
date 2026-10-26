import { UserComment } from "./user-comment.entity";
import { ThreadEnabledComment } from "../comment.types";
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne } from "typeorm";
import { Post } from "../../posts/entity/post.entity";
import { StatisticsTarget } from "../../statistics/entity/statistics-target.entity";

@Entity()
@Index(["profile", "post"])
@Index("UQ_post_comment_statistics_target", ["statisticsTargetId"], { unique: true })
export class PostComment
    extends UserComment
    implements ThreadEnabledComment<PostComment>
{
    @ManyToOne(() => Post, {
        onDelete: "CASCADE",
        nullable: false,
    })
    post: Post;
    @Column({
        nullable: false,
    })
    postId: string;

    @OneToOne(() => StatisticsTarget, { nullable: true, onDelete: "RESTRICT" })
    @JoinColumn({ name: "statisticsTargetId" })
    statisticsTarget: StatisticsTarget | null;
    @Column({ type: "bigint", unsigned: true, nullable: true })
    statisticsTargetId: number | null;

    @OneToMany(() => PostComment, (comment) => comment.childOf)
    parentOf: PostComment[] | null;

    @ManyToOne(() => PostComment, {
        nullable: true,
        onDelete: "CASCADE",
    })
    childOf: PostComment[] | null;
    @Column({
        nullable: true,
    })
    childOfId: string | null;
}
