import { PlayerProviderBudgetModule } from "../player-provider-budget.module";
import { Module } from "@nestjs/common";
import { SteamSyncService } from "./steam-sync.service";

@Module({
    imports: [PlayerProviderBudgetModule],
    providers: [SteamSyncService],
    exports: [SteamSyncService],
})
export class SteamSyncModule {}
