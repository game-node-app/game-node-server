import { PlayerProviderBudgetModule } from "../player-provider-budget.module";
import { Module } from "@nestjs/common";
import { SteamSyncService } from "./steam-sync.service";
import { SteamConnectionAuthProvider } from "./steam-connection-auth.provider";

@Module({
    imports: [PlayerProviderBudgetModule],
    providers: [SteamSyncService, SteamConnectionAuthProvider],
    exports: [SteamSyncService, SteamConnectionAuthProvider],
})
export class SteamSyncModule {}
