import { Module } from "@nestjs/common";
import { CommentService } from "./comment.service";
import { CommentController } from "./comment.controller";
import { StatisticsQueueModule } from "../statistics/statistics-queue/statistics-queue.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewComment } from "./entity/review-comment.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { SuspensionModule } from "../suspension/suspension.module";
import { ActivitiesRepositoryModule } from "../activities/activities-repository/activities-repository.module";
import { ActivityComment } from "./entity/activity-comment.entity";
import { PostComment } from "./entity/post-comment.entity";
import { PostsModule } from "../posts/posts.module";

/**
 * Module responsible for handling user comments.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([ReviewComment, ActivityComment, PostComment]),
        StatisticsQueueModule,
        NotificationsModule,
        ReviewsModule,
        ActivitiesRepositoryModule,
        PostsModule,
        SuspensionModule,
    ],
    providers: [CommentService],
    controllers: [CommentController],
    exports: [CommentService],
})
export class CommentModule {}
