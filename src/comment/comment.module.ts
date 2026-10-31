import { Module } from "@nestjs/common";
import { CommentService } from "./comment.service";
import { CommentController } from "./comment.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewComment } from "./entity/review-comment.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { ActivitiesRepositoryModule } from "../activities/activities-repository/activities-repository.module";
import { ActivityComment } from "./entity/activity-comment.entity";
import { PostComment } from "./entity/post-comment.entity";
import { PostsModule } from "../posts/posts.module";
import { AchievementsModule } from "../achievements/achievements.module";

/**
 * Module responsible for handling user comments.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([ReviewComment, ActivityComment, PostComment]),
        NotificationsModule,
        ReviewsModule,
        ActivitiesRepositoryModule,
        PostsModule,
        AchievementsModule,
    ],
    providers: [CommentService],
    controllers: [CommentController],
    exports: [CommentService],
})
export class CommentModule {}
