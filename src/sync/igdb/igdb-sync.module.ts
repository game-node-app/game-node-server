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
import {
    IGDB_CATALOG_QUEUE_NAME,
    IGDB_OUTBOUND_BUDGET_QUEUE_NAME,
    CATALOG_JOB_OPTIONS,
} from "./catalog/igdb-catalog.constants";
import { IgdbOutboundBudgetService } from "./catalog/igdb-outbound-budget.service";
import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";
import { IgdbPlaytimeSyncService } from "./playtime/igdb-playtime-sync.service";
import { IgdbAuthService } from "./auth/igdb-auth.service";
import { HttpModule } from "@nestjs/axios";
import { TypeOrmModule } from "@nestjs/typeorm";
import { IgdbCatalogState } from "./catalog/entities/igdb-catalog-state.entity";

/**
 * Fetches, checkpoints, and imports the IGDB catalog in-process. The playtime
 * sync shares the same authenticated outbound request budget.
 */
@Module({
    imports: [
        TypeOrmModule.forFeature([IgdbCatalogState]),
        BullModule.registerQueue({
            name: IGDB_CATALOG_QUEUE_NAME,
            defaultJobOptions: CATALOG_JOB_OPTIONS,
        }),
        BullModule.registerQueue({ name: IGDB_OUTBOUND_BUDGET_QUEUE_NAME }),
        GameRepositoryModule,
        HttpModule,
    ],
    controllers: [],
    providers: [
        { provide: CATALOG_CONFIG, useFactory: () => catalogConfig() },
        IgdbCatalogClient,
        IgdbCatalogStateService,
        IgdbCatalogImportService,
        IgdbCatalogRunnerService,
        IgdbCatalogSchedulerService,
        IgdbCatalogProcessor,
        IgdbAuthService,
        IgdbOutboundBudgetService,
        IgdbPlaytimeSyncService,
    ],
    exports: [IgdbPlaytimeSyncService],
})
export class IgdbSyncModule {}
