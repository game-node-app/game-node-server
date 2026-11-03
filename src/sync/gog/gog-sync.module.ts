import { PlayerProviderBudgetModule } from "../player-provider-budget.module";
import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GogSyncService } from "./gog-sync.service";
import { GogSyncAuthService } from "./auth/gog-sync-auth.service";
import { GogConnectionAuthProvider } from "./gog-connection-auth.provider";
import { UserConnection } from "../../connection/entity/user-connection.entity";
import { ConnectionsModule } from "../../connection/connections.module";

@Module({
    imports: [
        PlayerProviderBudgetModule,
        TypeOrmModule.forFeature([UserConnection]),
        forwardRef(() => ConnectionsModule),
    ],
    providers: [GogSyncService, GogSyncAuthService, GogConnectionAuthProvider],
    exports: [GogSyncService, GogSyncAuthService, GogConnectionAuthProvider],
})
export class GogSyncModule {}
