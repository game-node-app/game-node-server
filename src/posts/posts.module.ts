import { Module } from "@nestjs/common";
import { PostsService } from "./posts.service";
import { PostsController } from "./posts.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Post } from "./entity/post.entity";
import { PostsRepository } from "./posts.repository";

@Module({
    imports: [TypeOrmModule.forFeature([Post])],
    providers: [PostsService, PostsRepository],
    controllers: [PostsController],
    exports: [PostsService],
})
export class PostsModule {}
