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

@Entity()
@Index(["id", "createdAt"])
export class BlogPost extends BaseEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;
    /**
     * The post HTML content
     */
    @Column({
        nullable: false,
        type: "longtext",
    })
    content: string;

    @ManyToOne(() => Profile, {
        nullable: false,
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
     * Optional.
     */
    @OneToOne(() => BlogPostImage, {
        nullable: true,
    })
    @JoinColumn()
    image: BlogPostImage | null;
}
