import { Module } from "@nestjs/common";
import { HltbSyncService } from "./hltb-sync.service";
import { HltbController } from "./hltb.controller";
import { HltbSyncQueueService } from "./hltb-sync-queue.service";
import { HltbSyncSearchService } from "./hltb-sync-search.service";
import { BullModule } from "@nestjs/bullmq";
import { HLTB_SYNC_QUEUE_NAME } from "./hltb.constants";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GamePlaytime } from "./entity/game-playtime.entity";
import { HltbSyncProcessor } from "./hltb-sync.processor";
import { seconds } from "@nestjs/throttler";

@Module({
    imports: [
        TypeOrmModule.forFeature([GamePlaytime]),
        BullModule.registerQueue({
            name: HLTB_SYNC_QUEUE_NAME,
            defaultJobOptions: {
                attempts: 0,
                removeOnFail: true,
                removeOnComplete: true,
                delay: seconds(8),
            },
        }),
    ],
    providers: [
        HltbSyncService,
        HltbSyncQueueService,
        HltbSyncSearchService,
        HltbSyncProcessor,
    ],
    controllers: [HltbController],
    exports: [HltbSyncQueueService, HltbSyncService],
})
export class HltbSyncModule {}
