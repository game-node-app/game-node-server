import { Module } from "@nestjs/common";
import { HltbService } from "./hltb.service";
import { HltbController } from "./hltb.controller";
import { HltbQueueService } from "./hltb-queue.service";
import { HltbSearchService } from "./hltb-search.service";
import { BullModule } from "@nestjs/bullmq";
import { HLTB_SYNC_QUEUE_NAME } from "./hltb.constants";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GamePlaytime } from "./entity/game-playtime.entity";
import { HltbProcessor } from "./hltb.processor";

@Module({
    imports: [
        TypeOrmModule.forFeature([GamePlaytime]),
        BullModule.registerQueue({
            name: HLTB_SYNC_QUEUE_NAME,
        }),
    ],
    providers: [
        HltbService,
        HltbQueueService,
        HltbSearchService,
        HltbProcessor,
    ],
    controllers: [HltbController],
})
export class HltbModule {}
