import { Module } from "@nestjs/common";
import { IgdbSyncService } from "./igdb-sync.service";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";

/**
 * This module is responsible for handling game create/update with data
 * received from game-node-sync-igdb
 */
@Module({
    imports: [GameRepositoryModule],
    providers: [IgdbSyncService],
})
export class IgdbSyncModule {}
