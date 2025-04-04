import { Module } from "@nestjs/common";
import { PlaytimeService } from "./playtime.service";
import { PlaytimeController } from "./playtime.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { PlaytimeHistoryService } from "./playtime-history.service";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";

@Module({
    imports: [TypeOrmModule.forFeature([UserPlaytime, UserPlaytimeHistory])],
    providers: [PlaytimeService, PlaytimeHistoryService],
    controllers: [PlaytimeController],
    exports: [PlaytimeService],
})
export class PlaytimeModule {}
