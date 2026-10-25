import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { PLAYER_DATA_QUEUE } from "./player-data.constants";
import { PlayerDataQueueService } from "./player-data-queue.service";
import { PlayerSyncStateService } from "./player-sync-state.service";
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlayerConnectionSync } from "./entity/player-connection-sync.entity";
import { PlayerGameSync } from "./entity/player-game-sync.entity";

@Module({
    imports: [
        ConfigModule,
        BullModule.registerQueue({
            name: PLAYER_DATA_QUEUE,
            defaultJobOptions: {
                attempts: 5,
                backoff: 5000,
                removeOnComplete: { age: 3600, count: 1000 },
                removeOnFail: { age: 604800, count: 1000 },
            },
        }),
        TypeOrmModule.forFeature([PlayerConnectionSync, PlayerGameSync]),
    ],
    providers: [PlayerSyncStateService, PlayerDataQueueService],
    exports: [TypeOrmModule, PlayerSyncStateService, PlayerDataQueueService],
})
export class PlayerDataModule {}
