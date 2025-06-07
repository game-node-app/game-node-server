import {
    Column,
    Entity,
    Index,
    JoinColumn,
    JoinTable,
    ManyToMany,
    ManyToOne,
    OneToOne,
    PrimaryGeneratedColumn,
} from "typeorm";
import { BaseEntity } from "../../../utils/db/base.entity";
import { Profile } from "../../../profile/entities/profile.entity";
import { BlogPostTag } from "./blog-post-tag.entity";
import { BlogPostImage } from "./blog-post-image.entity";
import { BlogPostReview } from "./blog-post-review.entity";

@Entity()
@Index(["id", "createdAt", "isDraft"])
export class BlogPost extends BaseEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    @Column({
        nullable: false,
    })
    title: string;
    /**
     * The post HTML content
     */
    @Column({
        nullable: false,
        type: "longtext",
    })
    content: string;

    @Column({
        nullable: false,
        default: true,
    })
    isDraft: boolean;

    @ManyToOne(() => Profile, {
        nullable: false,
        onDelete: "CASCADE",
    })
    profile: Profile;
    @Column()
    profileUserId: string;

    @ManyToMany(() => BlogPostTag, {
        nullable: false,
    })
    @JoinTable()
    tags: BlogPostTag[];

    /**
     * The main presentation image for this post.
     */
    @OneToOne(() => BlogPostImage, {
        nullable: false,
    })
    @JoinColumn()
    image: BlogPostImage;
    /**
     * If this is present, this blog post is a game review.
     */
    @OneToOne(() => BlogPostReview, (bpr) => bpr.post, {
        nullable: true,
    })
    review: BlogPostReview | null;
}
