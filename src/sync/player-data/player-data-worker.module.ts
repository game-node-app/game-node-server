import { Module } from "@nestjs/common";
import { PlayerDataModule } from "./player-data.module";
import { PlayerDataProcessor } from "./player-data.processor";
import { PlaytimeWatchModule } from "../../playtime/watch/playtime-watch.module";
import { ImporterWatchModule } from "../../importer/importer-watch/importer-watch.module";

@Module({
    imports: [PlayerDataModule, PlaytimeWatchModule, ImporterWatchModule],
    providers: [PlayerDataProcessor],
})
export class PlayerDataWorkerModule {}
