import { PersistedImageDetails } from "../../../utils/db/persisted-image-details.entity";
import { Entity, OneToOne } from "typeorm";
import { BlogPost } from "./blog-post.entity";

@Entity()
export class BlogPostImage extends PersistedImageDetails {
    @OneToOne(() => BlogPost, (blogPost) => blogPost.image, {
        onDelete: "CASCADE",
    })
    blogPost: BlogPost;
}
