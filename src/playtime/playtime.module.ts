import { Module } from "@nestjs/common";
import { PlaytimeService } from "./playtime.service";
import { PlaytimeController } from "./playtime.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GamePlaytime } from "./entity/game-playtime.entity";

@Module({
    imports: [TypeOrmModule.forFeature([GamePlaytime])],
    providers: [PlaytimeService],
    controllers: [PlaytimeController],
    exports: [PlaytimeService],
})
export class PlaytimeModule {}
