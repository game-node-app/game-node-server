import { Module } from "@nestjs/common";
import { SteamSyncController } from "./steam-sync.controller";
import { SteamSyncService } from "./steam-sync.service";

@Module({
    controllers: [SteamSyncController],
    providers: [SteamSyncService],
    exports: [SteamSyncService],
})
export class SteamSyncModule {}
