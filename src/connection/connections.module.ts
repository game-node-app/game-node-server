import { PlayerDataModule } from "../sync/player-data/player-data.module";
import { forwardRef, Module, OnModuleInit } from "@nestjs/common";
import { ConnectionsService } from "./connections.service";
import { ConnectionsController } from "./connections.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserConnection } from "./entity/user-connection.entity";
import { UserConnectionCredential } from "./entity/user-connection-credential.entity";
import { SteamSyncModule } from "../sync/steam/steam-sync.module";
import { SteamConnectionAuthProvider } from "../sync/steam/steam-connection-auth.provider";
import { PsnSyncModule } from "../sync/psn/psn-sync.module";
import { PlaytimeModule } from "../playtime/playtime.module";
import { PlaytimeWatchModule } from "../playtime/watch/playtime-watch.module";
import { XboxSyncModule } from "../sync/xbox/xbox-sync.module";
import { XboxConnectionAuthProvider } from "../sync/xbox/xbox-connection-auth.provider";
import { ConnectionSyncModule } from "./connection-sync/connection-sync.module";
import { CollectionsModule } from "../collections/collections.module";
import { ConnectionCredentialCryptoService } from "./connection-credential-crypto.service";
import { ConnectionCredentialService } from "./connection-credential.service";
import { ConnectionAuthStateService } from "./connection-auth-state.service";
import { ConnectionProviderRegistry } from "./connection-provider.registry";
import { EConnectionType } from "./connections.constants";
import { PlayerProviderBudgetModule } from "../sync/player-provider-budget.module";
import { ConnectionProviderModule } from "./connection-provider.module";
import { PsnSyncService } from "../sync/psn/psn-sync.service";

@Module({
    imports: [
        PlayerProviderBudgetModule,
        ConnectionProviderModule,
        PlayerDataModule,
        TypeOrmModule.forFeature([UserConnection, UserConnectionCredential]),
        SteamSyncModule,
        PsnSyncModule,
        PlaytimeModule,
        XboxSyncModule,
        forwardRef(() => PlaytimeWatchModule),
        forwardRef(() => CollectionsModule),
        ConnectionSyncModule,
    ],
    providers: [
        ConnectionsService,
        ConnectionCredentialCryptoService,
        ConnectionCredentialService,
        ConnectionAuthStateService,
    ],
    controllers: [ConnectionsController],
    exports: [
        ConnectionsService,
        ConnectionCredentialCryptoService,
        ConnectionCredentialService,
        ConnectionAuthStateService,
        ConnectionProviderModule,
    ],
})
export class ConnectionsModule implements OnModuleInit {
    constructor(
        private readonly registry: ConnectionProviderRegistry,
        private readonly steamAuth: SteamConnectionAuthProvider,
        private readonly xboxAuth: XboxConnectionAuthProvider,
        private readonly psnSync: PsnSyncService,
    ) {}

    onModuleInit(): void {
        this.registry.registerAuthStrategy(EConnectionType.PSN, {
            resolvePublicIdentifier: async (identifier) => {
                const user = await this.psnSync.resolveUserInfo(identifier);
                return {
                    sourceUserId: user.userId,
                    sourceUsername: user.username,
                };
            },
        });
        this.registry.registerAuthStrategy(
            EConnectionType.STEAM,
            this.steamAuth,
        );
        this.registry.registerAuthStrategy(EConnectionType.XBOX, this.xboxAuth);
    }
}
