import { Module } from "@nestjs/common";
import { ActivitiesFeedService } from "./activities-feed.service";
import { ActivitiesFeedController } from "./activities-feed.controller";
import { ReviewsModule } from "src/reviews/reviews.module";
import { CollectionsModule } from "src/collections/collections.module";
import { ProfileModule } from "src/profile/profile.module";
import { ActivitiesRepositoryModule } from "../activities-repository/activities-repository.module";
import { CollectionsEntriesModule } from "../../collections/collections-entries/collections-entries.module";

@Module({
    imports: [
        ActivitiesRepositoryModule,
        ReviewsModule,
        CollectionsEntriesModule,
        ProfileModule,
    ],
    controllers: [ActivitiesFeedController],
    providers: [ActivitiesFeedService],
})
export class ActivitiesFeedModule {}
