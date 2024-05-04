import { Module } from "@nestjs/common";
import { ConnectionsService } from "./connections.service";
import { ConnectionsController } from "./connections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserConnection } from "./entity/user-connection.entity";

@Module({
    imports: [TypeOrmModule.forFeature([UserConnection])],
    providers: [ConnectionsService],
    controllers: [ConnectionsController],
})
export class ConnectionsModule {}
