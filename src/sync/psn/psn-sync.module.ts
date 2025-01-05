import { Module } from "@nestjs/common";
import { PsnSyncService } from "./psn-sync.service";
import { PsnSyncAuthService } from "./auth/psn-sync-auth.service";

@Module({
    providers: [PsnSyncService, PsnSyncAuthService],
    exports: [PsnSyncService],
})
export class PsnSyncModule {}
