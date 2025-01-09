import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GamePlaytime } from "../entity/game-playtime.entity";
import { UserPlaytime } from "../entity/user-playtime.entity";
import { BullModule } from "@nestjs/bullmq";
import { PLAYTIME_WATCH_QUEUE_NAME } from "./playtime-watch.constants";
import { GameRepositoryModule } from "../../game/game-repository/game-repository.module";
import { LibrariesModule } from "../../libraries/libraries.module";
import { ConnectionsModule } from "../../connections/connections.module";
import { PlaytimeWatchService } from "./playtime-watch.service";
import { PlaytimeWatchProcessor } from "./playtime-watch.processor";
import { PlaytimeModule } from "../playtime.module";
import { PsnSyncModule } from "../../sync/psn/psn-sync.module";
import { SteamSyncModule } from "../../sync/steam/steam-sync.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([UserPlaytime]),
        BullModule.registerQueue({
            name: PLAYTIME_WATCH_QUEUE_NAME,
            defaultJobOptions: {
                attempts: 1,
                removeOnFail: true,
                removeOnComplete: true,
            },
        }),
        PlaytimeModule,
        GameRepositoryModule,
        LibrariesModule,
        ConnectionsModule,
        PsnSyncModule,
        SteamSyncModule,
    ],
    providers: [PlaytimeWatchService, PlaytimeWatchProcessor],
})
export class PlaytimeWatchModule {}
