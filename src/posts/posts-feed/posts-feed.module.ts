import { Module } from "@nestjs/common";
import { PostsFeedService } from "./posts-feed.service";
import { PostsFeedController } from "./posts-feed.controller";
import { PostsModule } from "../posts.module";

@Module({
    imports: [PostsModule],
    providers: [PostsFeedService],
    controllers: [PostsFeedController],
})
export class PostsFeedModule {}
