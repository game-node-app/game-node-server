import { Column, Entity, JoinTable, OneToOne } from "typeorm";
import { Statistics } from "./statistics.entity";
import { Post } from "../../posts/entity/post.entity";

@Entity()
export class PostStatistics extends Statistics {
    @OneToOne(() => Post, {
        nullable: false,
        onDelete: "CASCADE",
    })
    @JoinTable()
    post: Post;
    @Column({
        nullable: false,
    })
    postId: string;
}
