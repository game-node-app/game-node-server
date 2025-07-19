import { Module } from "@nestjs/common";
import { PlaytimeService } from "./playtime.service";
import { PlaytimeController } from "./playtime.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserPlaytime } from "./entity/user-playtime.entity";
import { PlaytimeHistoryService } from "./playtime-history.service";
import { UserPlaytimeHistory } from "./entity/user-playtime-history.entity";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { TimeToBeatModule } from "./time-to-beat/time-to-beat.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([UserPlaytime, UserPlaytimeHistory]),
        GameRepositoryModule,
        TimeToBeatModule,
    ],
    providers: [PlaytimeService, PlaytimeHistoryService],
    controllers: [PlaytimeController],
    exports: [PlaytimeService, PlaytimeHistoryService],
})
export class PlaytimeModule {}
