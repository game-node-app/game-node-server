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

@Module({
    imports: [
        TypeOrmModule.forFeature([
            ImporterProcessedEntry,
            ImporterIgnoredEntry,
        ]),
        ConnectionsModule,
        SteamSyncModule,
        PsnSyncModule,
        XboxSyncModule,
        ExternalGameModule,
        GameRepositoryModule,
    ],
    providers: [ImporterService, ImporterSearchService],
    controllers: [ImporterController],
    exports: [ImporterService],
})
export class ImporterModule {}
