import { Module } from "@nestjs/common";
import { GameQueueService } from "./game-queue.service";
import { BullModule } from "@nestjs/bull";
import { GameRepositoryModule } from "../game-repository/game-repository.module";
import { GameQueueProcessor } from "./game-queue.processor";
import { GAME_QUEUE_NAME } from "./game-queue.constants";
import { GameQueueController } from "./game-queue.controller";

@Module({
    imports: [
        BullModule.registerQueue({
            name: GAME_QUEUE_NAME,
            limiter: {
                max: 5,
                duration: 1000,
            },
        }),
        GameRepositoryModule,
    ],
    providers: [GameQueueService, GameQueueProcessor],
    controllers: [GameQueueController],
})
export class GameQueueModule {}
