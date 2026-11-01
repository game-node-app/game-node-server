import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GameExternalGame } from "./entity/game-external-game.entity";
import { ExternalGameService } from "./external-game.service";
import { UnmappedExternalGame } from "./entity/unmapped-external-game.entity";
import { UnmappedExternalGameOwner } from "./entity/unmapped-external-game-owner.entity";
import { ExternalGameController } from "./external-game.controller";
import { ExternalGameMappingsService } from "./external-game-mappings.service";
import { PsnExtraMappings } from "./entity/psn-extra-mappings.entity";
import { EpicNamespaceFillProcessor } from "./epic-namespace-fill.processor";
import { EXTERNAL_GAME_MAPPING_QUEUE } from "./external-game-mapping.constants";

@Module({
    imports: [
        TypeOrmModule.forFeature([
            GameExternalGame,
            UnmappedExternalGame,
            UnmappedExternalGameOwner,
            PsnExtraMappings,
        ]),
        BullModule.registerQueue({ name: EXTERNAL_GAME_MAPPING_QUEUE }),
    ],
    controllers: [ExternalGameController],
    providers: [
        ExternalGameService,
        ExternalGameMappingsService,
        EpicNamespaceFillProcessor,
    ],
    exports: [ExternalGameService, ExternalGameMappingsService],
})
export class ExternalGameModule {}
