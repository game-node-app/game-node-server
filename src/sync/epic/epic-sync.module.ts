import { PlayerProviderBudgetModule } from "../player-provider-budget.module";
import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EpicSyncService } from "./epic-sync.service";
import { EpicSyncAuthService } from "./auth/epic-sync-auth.service";
import { EpicConnectionAuthProvider } from "./epic-connection-auth.provider";
import { UserConnection } from "../../connection/entity/user-connection.entity";
import { ConnectionsModule } from "../../connection/connections.module";

@Module({
    imports: [
        PlayerProviderBudgetModule,
        TypeOrmModule.forFeature([UserConnection]),
        forwardRef(() => ConnectionsModule),
    ],
    providers: [
        EpicSyncService,
        EpicSyncAuthService,
        EpicConnectionAuthProvider,
    ],
    exports: [EpicSyncService, EpicSyncAuthService, EpicConnectionAuthProvider],
})
export class EpicSyncModule {}
