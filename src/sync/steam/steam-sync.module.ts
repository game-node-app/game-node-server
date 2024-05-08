import { Module } from "@nestjs/common";
import { SteamSyncService } from "./steam-sync.service";

@Module({
    providers: [SteamSyncService],
    exports: [SteamSyncService],
})
export class SteamSyncModule {}
