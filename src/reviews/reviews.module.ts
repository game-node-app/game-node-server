import { Module } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import { ReviewsController } from "./reviews.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Review } from "./entities/review.entity";
import { ProfileModule } from "../profile/profile.module";
import { ActivitiesQueueModule } from "../activities/activities-queue/activities-queue.module";
import { StatisticsModule } from "../statistics/statistics.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Review]),
        ProfileModule,
        ActivitiesQueueModule,
        StatisticsModule,
    ],
    controllers: [ReviewsController],
    providers: [ReviewsService],
    exports: [ReviewsService],
})
export class ReviewsModule {}
