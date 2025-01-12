import { Module } from "@nestjs/common";
import { IgdbSyncService } from "./igdb-sync.service";
import { BullModule } from "@nestjs/bullmq";
import { IgdbSyncProcessor } from "./igdb-sync.processor";
import { IGDB_SYNC_QUEUE_NAME } from "./igdb-sync.constants";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";
import { IgdbSyncController } from "./igdb-sync.controller";

/**
 * This module is responsible for handling the game create/update queue.
 * The game-node-sync-igdb service is responsible for sending requests to
 * this module's controller, with a list of games returned from the IGDB API.
 */
@Module({
    imports: [
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
    ],
    controllers: [IgdbSyncController],
    providers: [IgdbSyncService, IgdbSyncProcessor],
})
export class IgdbSyncModule {}
