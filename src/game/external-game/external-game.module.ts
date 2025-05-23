import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameExternalGame } from "./entity/game-external-game.entity";
import { ExternalGameService } from "./external-game.service";
import { UnmappedExternalGame } from "./entity/unmapped-external-game.entity";
import { ExternalGameController } from "./external-game.controller";

@Module({
    imports: [
        TypeOrmModule.forFeature([GameExternalGame, UnmappedExternalGame]),
    ],
    controllers: [ExternalGameController],
    providers: [ExternalGameService],
    exports: [ExternalGameService],
})
export class ExternalGameModule {}
