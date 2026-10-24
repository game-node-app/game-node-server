import { IgdbCatalogSchedulerService } from "./catalog/igdb-catalog-scheduler.service";
import {
    IgdbCatalogClient,
    CATALOG_CONFIG,
} from "./catalog/igdb-catalog.client";
import { catalogConfig } from "./catalog/igdb-catalog.config";
import { IgdbCatalogStateService } from "./catalog/igdb-catalog-state.service";
import { IgdbCatalogImportService } from "./catalog/igdb-catalog-import.service";
import { IgdbCatalogRunnerService } from "./catalog/igdb-catalog-runner.service";
import { IgdbCatalogProcessor } from "./catalog/igdb-catalog.processor";
import { IgdbLegacyDrainService } from "./catalog/igdb-legacy-drain.service";
import {
    IGDB_CATALOG_QUEUE_NAME,
    CATALOG_JOB_OPTIONS,
} from "./catalog/igdb-catalog.constants";
import { IgdbOutboundBudgetService } from "./catalog/igdb-outbound-budget.service";
import { Module } from "@nestjs/common";
import { IgdbSyncService } from "./igdb-sync.service";
import { BullModule } from "@nestjs/bullmq";
import { IgdbSyncProcessor } from "./igdb-sync.processor";
import { IGDB_SYNC_QUEUE_NAME } from "./igdb-sync.constants";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";
import { IgdbSyncController } from "./igdb-sync.controller";
import { IgdbPlaytimeSyncService } from "./playtime/igdb-playtime-sync.service";
import { IgdbAuthService } from "./auth/igdb-auth.service";
import { HttpModule } from "@nestjs/axios";
import { TypeOrmModule } from "@nestjs/typeorm";
import { IgdbCatalogState } from "./catalog/entities/igdb-catalog-state.entity";

/**
 * This module is responsible for handling the game create/update queue.
 * The game-node-sync-igdb service is responsible for sending requests to
 * this module's controller, with a list of games returned from the IGDB API.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([IgdbCatalogState]),
        BullModule.registerQueue({
            name: IGDB_CATALOG_QUEUE_NAME,
            defaultJobOptions: CATALOG_JOB_OPTIONS,
        }),
        BullModule.registerQueue({
            name: IGDB_SYNC_QUEUE_NAME,
            defaultJobOptions: {
                // If this is not used, Redis will take a lot of ram for completed jobs
                removeOnComplete: true,
                removeOnFail: true,
                attempts: 1,
                backoff: 300,
            },
        }),
        GameRepositoryModule,
        HttpModule,
    ],
    controllers: [IgdbSyncController],
    providers: [
        { provide: CATALOG_CONFIG, useFactory: () => catalogConfig() },
        IgdbCatalogClient,
        IgdbCatalogStateService,
        IgdbCatalogImportService,
        IgdbCatalogRunnerService,
        IgdbCatalogSchedulerService,
        IgdbCatalogProcessor,
        IgdbLegacyDrainService,
        IgdbAuthService,
        IgdbOutboundBudgetService,
        IgdbSyncService,
        IgdbSyncProcessor,
        IgdbPlaytimeSyncService,
    ],
    exports: [IgdbPlaytimeSyncService],
})
export class IgdbSyncModule {}
