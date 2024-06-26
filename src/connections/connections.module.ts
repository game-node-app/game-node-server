import { Module } from "@nestjs/common";
import { ConnectionsService } from "./connections.service";
import { ConnectionsController } from "./connections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserConnection } from "./entity/user-connection.entity";
import { SteamSyncModule } from "../sync/steam/steam-sync.module";

@Module({
    imports: [TypeOrmModule.forFeature([UserConnection]), SteamSyncModule],
    providers: [ConnectionsService],
    controllers: [ConnectionsController],
    exports: [ConnectionsService],
})
export class ConnectionsModule {}
