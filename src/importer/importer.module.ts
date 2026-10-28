import { Module } from "@nestjs/common";
import { ImporterService } from "./importer.service";
import { ImporterController } from "./importer.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConnectionsModule } from "../connection/connections.module";
import { ImporterProcessedEntry } from "./entity/importer-processed-entry.entity";
import { ImporterIgnoredEntry } from "./entity/importer-ignored-entry.entity";
import { SteamSyncModule } from "../sync/steam/steam-sync.module";
import { PsnSyncModule } from "../sync/psn/psn-sync.module";
import { ExternalGameModule } from "../game/external-game/external-game.module";
import { XboxSyncModule } from "../sync/xbox/xbox-sync.module";
import { ImporterSearchService } from "./importer-search/importer-search.service";
import { PreferredPlatformModule } from "../preferred-platform/preferred-platform.module";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { Game } from "../game/game-repository/entities/game.entity";
import { CollectionsEntriesModule } from "../collections/collections-entries/collections-entries.module";
import { ImporterBatchImportService } from "./importer-batch-import.service";
import { ImporterBatchEffectsService } from "./importer-batch-effects.service";
import { ImporterBatchEffect } from "./entity/importer-batch-effect.entity";
import { ActivitiesQueueModule } from "../activities/activities-queue/activities-queue.module";
import { AchievementsModule } from "../achievements/achievements.module";
import { LevelModule } from "../level/level.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            ImporterProcessedEntry,
            ImporterIgnoredEntry,
            CollectionEntry,
            Game,
            ImporterBatchEffect,
        ]),
        ConnectionsModule,
        SteamSyncModule,
        PsnSyncModule,
        XboxSyncModule,
        ExternalGameModule,
        GameRepositoryModule,
        CollectionsEntriesModule,
        ActivitiesQueueModule,
        AchievementsModule,
        LevelModule,
    ],
    providers: [
        ImporterService,
        ImporterSearchService,
        ImporterBatchImportService,
        ImporterBatchEffectsService,
    ],
    controllers: [ImporterController],
    exports: [ImporterService],
})
export class ImporterModule {}
