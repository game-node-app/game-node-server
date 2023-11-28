import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { ActivitiesQueueModule } from "../../activities/activities-queue/activities-queue.module";
import { CollectionsEntriesController } from "./collections-entries.controller";
import { CollectionsEntriesService } from "./collections-entries.service";
import { GamePlatform } from "../../game/game-repository/entities/game-platform.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([CollectionEntry, GamePlatform]),
        ActivitiesQueueModule,
    ],
    controllers: [CollectionsEntriesController],
    providers: [CollectionsEntriesService],
    exports: [CollectionsEntriesService],
})
export class CollectionsEntriesModule {}
