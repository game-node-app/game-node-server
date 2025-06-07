import { BaseEntity } from "../../../utils/db/base.entity";
import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToOne,
    PrimaryColumn,
} from "typeorm";
import { Game } from "../../../game/game-repository/entities/game.entity";
import { BlogPost } from "./blog-post.entity";

/**
 * Auxiliary table that contains information relevant to games reviews posted in the blog system.
 * A blog post can be considered a game review if a entity of this type is associated with it.
 */
@Entity()
export class BlogPostReview extends BaseEntity {
    /**
     * PK and FK targeting BlogPost
     */
    @PrimaryColumn()
    postId: string;
    @ManyToOne(() => Game, {
        nullable: false,
    })
    game: Game;
    @Column({
        nullable: false,
    })
    gameId: number;
    @Column({ nullable: false, type: "float" })
    rating: number;
    @OneToOne(() => BlogPost, (bp) => bp.review)
    @JoinColumn()
    post: BlogPost;
}
