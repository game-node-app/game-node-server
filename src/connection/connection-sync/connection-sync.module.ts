import { forwardRef, Module } from "@nestjs/common";
import { ConnectionSyncGateway } from "./connection-sync.gateway";
import { PlaytimeWatchModule } from "../../playtime/watch/playtime-watch.module";

@Module({
    imports: [forwardRef(() => PlaytimeWatchModule)],
    providers: [ConnectionSyncGateway],
    exports: [ConnectionSyncGateway],
})
export class ConnectionSyncModule {}
