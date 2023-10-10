import { forwardRef, Module } from "@nestjs/common";
import { IgdbSyncService } from "./igdb-sync.service";
import { IgdbSyncAuthService } from "./igdb-sync-auth.service";
import { HttpModule } from "@nestjs/axios";
import { IgdbSyncQueueModule } from "./igdb-sync-queue/igdb-sync-queue.module";

@Module({
    imports: [HttpModule, IgdbSyncQueueModule],
    providers: [IgdbSyncService, IgdbSyncAuthService],
})
export class IgdbSyncModule {}
