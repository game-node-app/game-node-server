import { Module } from "@nestjs/common";
import { GameQueueService } from "./game-queue.service";
import { BullModule } from "@nestjs/bull";
import { GameRepositoryModule } from "../game-repository/game-repository.module";
import { GameQueueProcessor } from "./game-queue.processor";
import { GAME_QUEUE_NAME } from "./game-queue.constants";
import { GameQueueController } from "./game-queue.controller";

/**
 * This module is responsible for handling the game queue.
 * It uses Bull to handle the queue and the processor. The game-node-sync/igdb service is responsible
 * for sending requests to this module's controller, with a list of games returned from the IGDB API.
 */
@Module({
    imports: [
        BullModule.registerQueue({
            name: GAME_QUEUE_NAME,
            limiter: {
                // Process only one job (chunk of games) per second
                max: 1,
                duration: 1000,
            },
            defaultJobOptions: {
                // If this is not used, Redis will take a lot of ram for completed jobs
                removeOnComplete: true,
                removeOnFail: true,
            },
        }),
        GameRepositoryModule,
    ],
    providers: [GameQueueService, GameQueueProcessor],
    controllers: [GameQueueController],
})
export class GameQueueModule {}
