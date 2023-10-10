import { Module } from "@nestjs/common";
import { IgdbSyncQueueService } from "./igdb-sync-queue.service";
import { BullModule } from "@nestjs/bull";
import { GameModule } from "../../game/game.module";
import { IgdbSyncQueueProcessor } from "./igdb-sync-queue.processor";
import { IGDB_SYNC_QUEUE_NAME } from "./igdb-sync-queue.constants";

@Module({
    imports: [
        BullModule.registerQueue({
            name: IGDB_SYNC_QUEUE_NAME,
            limiter: {
                max: 2,
                duration: 1000,
            },
        }),
        GameModule,
    ],
    providers: [IgdbSyncQueueService, IgdbSyncQueueProcessor],
    exports: [IgdbSyncQueueService],
})
export class IgdbSyncQueueModule {}
