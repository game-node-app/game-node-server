import { Module } from "@nestjs/common";
import { ReviewsService } from "./reviews.service";
import { ReviewsController } from "./reviews.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Review } from "./entities/review.entity";
import { ProfileModule } from "../profile/profile.module";
import { ActivitiesQueueModule } from "../activities/activities-queue/activities-queue.module";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { CollectionsEntriesModule } from "../collections/collections-entries/collections-entries.module";
import { AchievementsModule } from "../achievements/achievements.module";
import { StatisticsQueueModule } from "../statistics/statistics-queue/statistics-queue.module";
import { LevelModule } from "../level/level.module";
import { SuspensionModule } from "../suspension/suspension.module";
import { MentionModule } from "../mention/mention.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Review, CollectionEntry]),
        SuspensionModule,
        ProfileModule,
        ActivitiesQueueModule,
        AchievementsModule,
        CollectionsEntriesModule,
        StatisticsQueueModule,
        LevelModule,
        MentionModule,
    ],
    controllers: [ReviewsController],
    providers: [ReviewsService],
    exports: [ReviewsService],
})
export class ReviewsModule {}
