import { forwardRef, Module } from "@nestjs/common";
import { ConnectionSyncGateway } from "./connection-sync.gateway";
import { PlaytimeWatchModule } from "../../playtime/watch/playtime-watch.module";
import { ThrottlerModule } from "@nestjs/throttler";

@Module({
    imports: [forwardRef(() => PlaytimeWatchModule), ThrottlerModule.forRoot()],
    providers: [ConnectionSyncGateway],
    exports: [ConnectionSyncGateway],
})
export class ConnectionSyncModule {}
