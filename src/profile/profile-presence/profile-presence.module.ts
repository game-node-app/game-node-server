import { Module } from "@nestjs/common";
import { BillingModule } from "../../billing/billing.module";
import { ConnectionsModule } from "../../connection/connections.module";
import { ExternalGameModule } from "../../game/external-game/external-game.module";
import { SteamSyncModule } from "../../sync/steam/steam-sync.module";
import { SupporterPreferencesModule } from "../supporter-preferences/supporter-preferences.module";
import { ProfilePresenceController } from "./profile-presence.controller";
import { ProfilePresenceService } from "./profile-presence.service";

/**
 * Design 6: imported from AppModule, not ProfileModule, because ConnectionsModule
 * already has forward references into collections and playtime.
 */
@Module({
    imports: [
        BillingModule,
        SupporterPreferencesModule,
        ConnectionsModule,
        SteamSyncModule,
        ExternalGameModule,
    ],
    controllers: [ProfilePresenceController],
    providers: [ProfilePresenceService],
})
export class ProfilePresenceModule {}
