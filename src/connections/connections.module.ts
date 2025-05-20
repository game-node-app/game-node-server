import { forwardRef, Module } from "@nestjs/common";
import { ConnectionsService } from "./connections.service";
import { ConnectionsController } from "./connections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserConnection } from "./entity/user-connection.entity";
import { SteamSyncModule } from "../sync/steam/steam-sync.module";
import { PsnSyncModule } from "../sync/psn/psn-sync.module";
import { PlaytimeModule } from "../playtime/playtime.module";
import { PlaytimeWatchModule } from "../playtime/watch/playtime-watch.module";
import { XboxSyncModule } from "../sync/xbox/xbox-sync.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([UserConnection]),
        SteamSyncModule,
        PsnSyncModule,
        PlaytimeModule,
        XboxSyncModule,
        forwardRef(() => PlaytimeWatchModule),
    ],
    providers: [ConnectionsService],
    controllers: [ConnectionsController],
    exports: [ConnectionsService],
})
export class ConnectionsModule {}
