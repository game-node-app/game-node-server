import { PlayerProviderBudgetModule } from "../player-provider-budget.module";
import { Module } from "@nestjs/common";
import { XboxSyncService } from "./xbox-sync.service";
import { XboxSyncAuthService } from "./auth/xbox-sync-auth.service";

@Module({
    imports: [PlayerProviderBudgetModule],
    providers: [XboxSyncService, XboxSyncAuthService],
    exports: [XboxSyncService],
})
export class XboxSyncModule {}
