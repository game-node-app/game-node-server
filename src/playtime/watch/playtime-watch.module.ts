import { forwardRef, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserPlaytime } from "../entity/user-playtime.entity";
import { BullModule } from "@nestjs/bullmq";
import { PLAYTIME_WATCH_QUEUE_NAME } from "./playtime-watch.constants";
import { LibrariesModule } from "../../libraries/libraries.module";
import { ConnectionsModule } from "../../connections/connections.module";
import { PlaytimeWatchService } from "./playtime-watch.service";
import { PlaytimeWatchProcessor } from "./playtime-watch.processor";
import { PlaytimeModule } from "../playtime.module";
import { PsnSyncModule } from "../../sync/psn/psn-sync.module";
import { SteamSyncModule } from "../../sync/steam/steam-sync.module";
import { ExternalGameModule } from "../../game/external-game/external-game.module";
import { XboxSyncModule } from "../../sync/xbox/xbox-sync.module";
import { seconds } from "@nestjs/throttler";

@Module({
    imports: [
        TypeOrmModule.forFeature([UserPlaytime]),
        BullModule.registerQueue({
            name: PLAYTIME_WATCH_QUEUE_NAME,
            defaultJobOptions: {
                attempts: 5,
                removeOnFail: true,
                removeOnComplete: true,
                backoff: seconds(5),
            },
        }),
        PlaytimeModule,
        ExternalGameModule,
        LibrariesModule,
        forwardRef(() => ConnectionsModule),
        PsnSyncModule,
        SteamSyncModule,
        XboxSyncModule,
    ],
    providers: [PlaytimeWatchService, PlaytimeWatchProcessor],
    exports: [PlaytimeWatchService],
})
export class PlaytimeWatchModule {}
