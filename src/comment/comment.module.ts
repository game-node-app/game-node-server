import { Module } from "@nestjs/common";
import { CommentService } from "./comment.service";
import { CommentController } from "./comment.controller";
import { StatisticsQueueModule } from "../statistics/statistics-queue/statistics-queue.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewComment } from "./entity/review-comment.entity";

/**
 * Module responsible for handling user comments.
 */
@Module({
    imports: [TypeOrmModule.forFeature([ReviewComment]), StatisticsQueueModule],
    providers: [CommentService],
    controllers: [CommentController],
})
export class CommentModule {}
