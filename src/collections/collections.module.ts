import { Module } from "@nestjs/common";
import { CollectionsService } from "./collections.service";
import { CollectionsController } from "./collections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Collection } from "./entities/collection.entity";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { LibrariesModule } from "../libraries/libraries.module";
import { CollectionsEntriesService } from "./collections-entries/collections-entries.service";
import { CollectionsEntriesController } from "./collections-entries/collections-entries.controller";
import { ActivitiesQueueModule } from "src/activities/activities-queue/activities-queue.module";
import { ReviewsModule } from "../reviews/reviews.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([Collection, CollectionEntry]),
        LibrariesModule,
        ActivitiesQueueModule,
        ReviewsModule,
    ],
    controllers: [CollectionsController, CollectionsEntriesController],
    providers: [CollectionsService, CollectionsEntriesService],
    exports: [CollectionsService, CollectionsEntriesService],
})
export class CollectionsModule {}
