import { Module } from "@nestjs/common";
import { BlogPostService } from "./blog-post.service";
import { BlogPostController } from "./blog-post.controller";
import { BlogPost } from "./entity/blog-post.entity";
import { BlogPostTag } from "./entity/blog-post-tag.entity";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BlogPostImage } from "./entity/blog-post-image.entity";
import { BlogPostV2Controller } from "./blog-post-v2.controller";

@Module({
    imports: [TypeOrmModule.forFeature([BlogPost, BlogPostTag, BlogPostImage])],
    providers: [BlogPostService],
    controllers: [BlogPostController, BlogPostV2Controller],
})
export class BlogPostModule {}
