import { Module } from "@nestjs/common";
import { ImporterService } from "./importer.service";
import { ImporterController } from "./importer.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConnectionsModule } from "../connections/connections.module";
import { ImporterProcessedEntry } from "./entity/importer-processed-entry.entity";
import { ImporterIgnoredEntry } from "./entity/importer-ignored-entry.entity";
import { SteamSyncModule } from "../sync/steam/steam-sync.module";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { ImporterWatchModule } from "./importer-watch/importer-watch.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            ImporterProcessedEntry,
            ImporterIgnoredEntry,
        ]),
        ConnectionsModule,
        SteamSyncModule,
        GameRepositoryModule,
    ],
    providers: [ImporterService],
    controllers: [ImporterController],
    exports: [ImporterService],
})
export class ImporterModule {}
