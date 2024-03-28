import { Injectable } from "@nestjs/common";
import { RabbitSubscribe } from "@golevelup/nestjs-rabbitmq";
import { GameSyncObject } from "../../game/game-repository/game-repository.types";
import { GAME_SYNC_RABBITMQ_QUEUE_CONFIG } from "../../game/game-repository/game-repository.constants";
import { HltbService } from "./hltb.service";
import { InjectQueue } from "@nestjs/bullmq";
import {
    HLTB_SYNC_QUEUE_JOB_NAME,
    HLTB_SYNC_QUEUE_NAME,
} from "./hltb.constants";
import { Queue } from "bullmq";
import { HLTBJobData } from "./hltb.types";

@Injectable()
export class HltbQueueService {
    constructor(
        @InjectQueue(HLTB_SYNC_QUEUE_NAME)
        private hltbQueue: Queue,
        private readonly hltbService: HltbService,
    ) {}

    @RabbitSubscribe({
        queue: GAME_SYNC_RABBITMQ_QUEUE_CONFIG.name,
        name: GAME_SYNC_RABBITMQ_QUEUE_CONFIG.name,
        exchange: GAME_SYNC_RABBITMQ_QUEUE_CONFIG.exchange,
        routingKey: GAME_SYNC_RABBITMQ_QUEUE_CONFIG.routingKey,
    })
    async gameCreateUpdateEventSubscribe(msg: GameSyncObject) {
        const shouldUpdate = await this.hltbService.isEligibleForUpdate(msg.id);
        if (!shouldUpdate) return;
        await this.hltbQueue.add(HLTB_SYNC_QUEUE_JOB_NAME, {
            gameId: msg.id,
            name: msg.name,
        } satisfies HLTBJobData);
    }
}
