import { Module } from "@nestjs/common";
import { CommentService } from "./comment.service";
import { CommentController } from "./comment.controller";
import { StatisticsQueueModule } from "../statistics/statistics-queue/statistics-queue.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewComment } from "./entity/review-comment.entity";
import { NotificationsModule } from "../notifications/notifications.module";
import { ReviewsModule } from "../reviews/reviews.module";
import { SuspensionModule } from "../suspension/suspension.module";

/**
 * Module responsible for handling user comments.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([ReviewComment]),
        StatisticsQueueModule,
        NotificationsModule,
        ReviewsModule,
        SuspensionModule,
    ],
    providers: [CommentService],
    controllers: [CommentController],
})
export class CommentModule {}
