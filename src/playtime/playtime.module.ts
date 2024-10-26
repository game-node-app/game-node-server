import { forwardRef, Module } from "@nestjs/common";
import { PlaytimeService } from "./playtime.service";
import { PlaytimeController } from "./playtime.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GamePlaytime } from "./entity/game-playtime.entity";
import { GameRepositoryModule } from "../game/game-repository/game-repository.module";
import { HltbSyncModule } from "../sync/hltb/hltb-sync.module";

@Module({
    imports: [
        TypeOrmModule.forFeature([GamePlaytime]),
        GameRepositoryModule,
        forwardRef(() => HltbSyncModule),
    ],
    providers: [PlaytimeService],
    controllers: [PlaytimeController],
    exports: [PlaytimeService],
})
export class PlaytimeModule {}
