import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameExternalGame } from "./entity/game-external-game.entity";
import { ExternalGameService } from "./external-game.service";
import { UnmappedExternalGame } from "./entity/unmapped-external-game.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([GameExternalGame, UnmappedExternalGame]),
    ],
    providers: [ExternalGameService],
    exports: [ExternalGameService],
})
export class ExternalGameModule {}
