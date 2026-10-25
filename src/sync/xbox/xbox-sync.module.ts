import { PlayerProviderBudgetModule } from "../player-provider-budget.module";
import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { XboxSyncService } from "./xbox-sync.service";
import { XboxSyncAuthService } from "./auth/xbox-sync-auth.service";
import { XboxConnectionAuthProvider } from "./xbox-connection-auth.provider";
import { UserConnection } from "../../connection/entity/user-connection.entity";
import { ConnectionsModule } from "../../connection/connections.module";

@Module({
    imports: [
        PlayerProviderBudgetModule,
        TypeOrmModule.forFeature([UserConnection]),
        forwardRef(() => ConnectionsModule),
    ],
    providers: [
        XboxSyncService,
        XboxSyncAuthService,
        XboxConnectionAuthProvider,
    ],
    exports: [
        XboxSyncService,
        XboxSyncAuthService,
        XboxConnectionAuthProvider,
    ],
})
export class XboxSyncModule {}
