import { forwardRef, Module } from "@nestjs/common";
import { PostsService } from "./posts.service";
import { PostsController } from "./posts.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Post } from "./entity/post.entity";
import { PostsRepository } from "./posts.repository";
import { ActivitiesQueueModule } from "../activities/activities-queue/activities-queue.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { GuildQueueModule } from "../guild/guild-queue/guild-queue.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Post]),
        NotificationsModule,
        forwardRef(() => ActivitiesQueueModule),
        GuildQueueModule,
    ],
    providers: [PostsService, PostsRepository],
    controllers: [PostsController],
    exports: [PostsService],
})
export class PostsModule {}
