import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameExternalGame } from "./entity/game-external-game.entity";
import { ExternalGameService } from "./external-game.service";
import { UnmappedExternalGame } from "./entity/unmapped-external-game.entity";
import { ExternalGameController } from "./external-game.controller";
import { ExternalGameMappingsService } from "./external-game-mappings.service";
import { PsnExtraMappings } from "./entity/psn-extra-mappings.entity";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            GameExternalGame,
            UnmappedExternalGame,
            PsnExtraMappings,
        ]),
    ],
    controllers: [ExternalGameController],
    providers: [ExternalGameService, ExternalGameMappingsService],
    exports: [ExternalGameService, ExternalGameMappingsService],
})
export class ExternalGameModule {}
