import { Module } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ActivitiesFeedController } from "./activities-feed.controller";
import { ReviewsModule } from "src/reviews/reviews.module";
import { ProfileModule } from "src/profile/profile.module";
import { ActivitiesRepositoryModule } from "../activities-repository/activities-repository.module";
import { CollectionsEntriesModule } from "../../collections/collections-entries/collections-entries.module";
import { StatisticsModule } from "../../statistics/statistics.module";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Activity } from "../activities-repository/entities/activity.entity";

@Module({
    imports: [
        ActivitiesRepositoryModule,
        ReviewsModule,
        CollectionsEntriesModule,
        ProfileModule,
        StatisticsModule,
        TypeOrmModule.forFeature([Activity]),
    ],
    controllers: [ActivitiesFeedController],
    providers: [ActivitiesFeedService],
})
export class ActivitiesFeedModule {}
