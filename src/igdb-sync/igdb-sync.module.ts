import { Module } from "@nestjs/common";
import { IgdbSyncService } from "./igdb-sync.service";
import { IgdbSyncAuthService } from "./igdb-sync-auth.service";
import { GameModule } from "../game/game.module";
import { HttpModule } from "@nestjs/axios";

@Module({
    imports: [HttpModule, GameModule],
    providers: [IgdbSyncService, IgdbSyncAuthService],
})
export class IgdbSyncModule {}
