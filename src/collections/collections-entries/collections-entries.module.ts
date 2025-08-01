import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CollectionEntry } from "./entities/collection-entry.entity";
import { ActivitiesQueueModule } from "../../activities/activities-queue/activities-queue.module";
import { CollectionsEntriesController } from "./collections-entries.controller";
import { CollectionsEntriesService } from "./collections-entries.service";
import { GamePlatform } from "../../game/game-repository/entities/game-platform.entity";
import { AchievementsModule } from "../../achievements/achievements.module";
import { LevelModule } from "../../level/level.module";
import { CollectionsModule } from "../collections.module";
import { CollectionEntryToCollection } from "./entities/collection-entry-to-collection.entity";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            CollectionEntry,
            GamePlatform,
            CollectionEntryToCollection,
        ]),
        ActivitiesQueueModule,
        AchievementsModule,
        LevelModule,
        forwardRef(() => CollectionsModule),
        GameRepositoryModule,
    ],
    controllers: [CollectionsEntriesController],
    providers: [CollectionsEntriesService],
    exports: [CollectionsEntriesService],
})
export class CollectionsEntriesModule {}
