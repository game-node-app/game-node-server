import { Module } from "@nestjs/common";
import { SteamSyncController } from "./steam-sync-controller";
import { SteamSyncService } from "./steam-sync.service";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SteamUserMap } from "./entity/steam-user-map.entity";

@Module({
    imports: [TypeOrmModule.forFeature([SteamUserMap])],
    controllers: [SteamSyncController],
    providers: [SteamSyncService],
})
export class SteamSyncModule {}
