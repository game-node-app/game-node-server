import { Module } from "@nestjs/common";
import { IgdbSyncService } from "./igdb-sync.service";
import { BullModule } from "@nestjs/bull";
import { IgdbSyncProcessor } from "./igdb-sync.processor";
import { IGDB_SYNC_QUEUE_NAME } from "./game-queue.constants";
import { IgdbSyncController } from "./igdb-sync.controller";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";

/**
 * This module is responsible for handling the game create/update queue.
 * The game-node-sync-igdb service is responsible for sending requests to
 * this module's controller, with a list of games returned from the IGDB API.
 */
@Module({
    imports: [
        BullModule.registerQueue({
            name: IGDB_SYNC_QUEUE_NAME,
            limiter: {
                // Process only one job (chunk of games) per second
                max: 1,
                duration: 1000,
            },
            defaultJobOptions: {
                // If this is not used, Redis will take a lot of ram for completed jobs
                removeOnComplete: true,
                removeOnFail: true,
            },
        }),
        GameRepositoryModule,
    ],
    providers: [IgdbSyncService, IgdbSyncProcessor],
    controllers: [IgdbSyncController],
})
export class IgdbSyncModule {}
