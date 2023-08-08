import { Module } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ActivitiesFeedController } from "./activities-feed.controller";
import { ReviewsModule } from "src/reviews/reviews.module";
import { CollectionsModule } from "src/collections/collections.module";
import { ProfileModule } from "src/profile/profile.module";
import { ActivitiesRepositoryModule } from "../activities-repository/activities-repository.module";

@Module({
    imports: [
        ActivitiesRepositoryModule,
        ReviewsModule,
        CollectionsModule,
        ProfileModule,
    ],
    controllers: [ActivitiesFeedController],
    providers: [ActivitiesFeedService],
})
export class ActivitiesFeedModule {}
