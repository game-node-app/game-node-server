import { Module } from "@nestjs/common";
import { StatisticsReviewService } from "./statistics-review.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { StatisticsReviewController } from "./statistics-review.controller";
import { StatisticsReviewQueueService } from "./statistics-review-queue.service";
import { StatisticsReviewQueueController } from "./statistics-review-queue.controller";
import { ReviewsModule } from "../../reviews/reviews.module";
import { UserLike } from "../entity/user-like.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([ReviewStatistics, UserLike]),
        ReviewsModule,
    ],
    providers: [StatisticsReviewService, StatisticsReviewQueueService],
    controllers: [StatisticsReviewController, StatisticsReviewQueueController],
})
export class StatisticsReviewModule {}
