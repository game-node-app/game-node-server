import { PlayerProviderBudgetModule } from "../player-provider-budget.module";
import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NintendoSyncService } from "./nintendo-sync.service";
import { NintendoSyncAuthService } from "./auth/nintendo-sync-auth.service";
import { NintendoConnectionAuthProvider } from "./nintendo-connection-auth.provider";
import { UserConnection } from "../../connection/entity/user-connection.entity";
import { ConnectionsModule } from "../../connection/connections.module";

@Module({
    imports: [
        PlayerProviderBudgetModule,
        TypeOrmModule.forFeature([UserConnection]),
        forwardRef(() => ConnectionsModule),
    ],
    providers: [
        NintendoSyncService,
        NintendoSyncAuthService,
        NintendoConnectionAuthProvider,
    ],
    exports: [
        NintendoSyncService,
        NintendoSyncAuthService,
        NintendoConnectionAuthProvider,
    ],
})
export class NintendoSyncModule {}
