import { PlayerProviderBudgetModule } from "../player-provider-budget.module";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PsnSyncService } from "./psn-sync.service";
import { PsnSyncAuthService } from "./auth/psn-sync-auth.service";
import { PsnSyncAuthScheduler } from "./auth/psn-sync-auth.scheduler";
import { PsnSystemCredential } from "./auth/psn-system-credential.entity";
import { PsnAdminController } from "./admin/psn-admin.controller";
// Provided directly: ConnectionsModule imports this module, so importing it back would create a cycle.
import { ConnectionCredentialCryptoService } from "../../connection/connection-credential-crypto.service";

@Module({
    imports: [
        PlayerProviderBudgetModule,
        TypeOrmModule.forFeature([PsnSystemCredential]),
    ],
    controllers: [PsnAdminController],
    providers: [
        PsnSyncService,
        PsnSyncAuthService,
        PsnSyncAuthScheduler,
        ConnectionCredentialCryptoService,
    ],
    exports: [PsnSyncService],
})
export class PsnSyncModule {}
