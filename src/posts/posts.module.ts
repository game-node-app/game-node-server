import { forwardRef, Module } from "@nestjs/common";
import { PostsService } from "./posts.service";
import { PostsController } from "./posts.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Post } from "./entity/post.entity";
import { PostsRepository } from "./posts.repository";
import { SuspensionModule } from "../suspension/suspension.module";
import { ActivitiesQueueModule } from "../activities/activities-queue/activities-queue.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Post]),
        SuspensionModule,
        forwardRef(() => ActivitiesQueueModule),
    ],
    providers: [PostsService, PostsRepository],
    controllers: [PostsController],
    exports: [PostsService],
})
export class PostsModule {}
