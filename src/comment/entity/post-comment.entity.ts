import { UserComment } from "./user-comment.entity";
import { ThreadEnabledComment } from "../comment.types";
import { Column, Entity, Index, ManyToOne, OneToMany } from "typeorm";
import { Post } from "../../posts/entity/post.entity";

@Entity()
@Index(["profile", "post"])
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
