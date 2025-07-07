import { Module } from "@nestjs/common";
import { TimeToBeatController } from "./time-to-beat.controller";
import { TimeToBeatService } from "./time-to-beat.service";
import { IgdbSyncModule } from "../../sync/igdb/igdb-sync.module";

@Module({
    imports: [IgdbSyncModule],
    controllers: [TimeToBeatController],
    providers: [TimeToBeatService],
})
export class TimeToBeatModule {}
