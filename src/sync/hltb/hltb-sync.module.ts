import { forwardRef, Module } from "@nestjs/common";
import { HltbSyncUpdateService } from "./hltb-sync-update.service";
import { PlaytimeModule } from "../../playtime/playtime.module";

@Module({
    imports: [forwardRef(() => PlaytimeModule)],
    providers: [HltbSyncUpdateService],
    exports: [HltbSyncUpdateService],
})
export class HltbSyncModule {}
