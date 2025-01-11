import { Module } from "@nestjs/common";
import { PlaytimeService } from "./playtime.service";
import { PlaytimeController } from "./playtime.controller";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserPlaytime } from "./entity/user-playtime.entity";

@Module({
    imports: [TypeOrmModule.forFeature([UserPlaytime])],
    providers: [PlaytimeService],
    controllers: [PlaytimeController],
    exports: [PlaytimeService],
})
export class PlaytimeModule {}
