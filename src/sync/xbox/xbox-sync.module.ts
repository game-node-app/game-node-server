import { Module } from "@nestjs/common";
import { XboxSyncService } from "./xbox-sync.service";
import { XboxSyncAuthService } from "./auth/xbox-sync-auth.service";

@Module({
    providers: [XboxSyncService, XboxSyncAuthService],
    exports: [XboxSyncService],
})
export class XboxSyncModule {}
