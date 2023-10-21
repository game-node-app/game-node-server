import { Module } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import { ReviewsController } from "./reviews.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Review } from "./entities/review.entity";
import { ProfileModule } from "../profile/profile.module";
import { ActivitiesQueueModule } from "../activities/activities-queue/activities-queue.module";
import { StatisticsQueueModule } from "../statistics/statistics-queue/statistics-queue.module";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([Review, CollectionEntry]),
        ProfileModule,
        ActivitiesQueueModule,
        StatisticsQueueModule,
    ],
    controllers: [ReviewsController],
    providers: [ReviewsService],
    exports: [ReviewsService],
})
export class ReviewsModule {}
