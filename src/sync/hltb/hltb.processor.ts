import { Processor } from "@nestjs/bullmq";
import {
    HLTB_SYNC_QUEUE_JOB_NAME,
    HLTB_SYNC_QUEUE_NAME,
} from "./hltb.constants";
import { HltbService } from "./hltb.service";
import { HltbSearchService } from "./hltb-search.service";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { Job } from "bullmq";
import { HLTBJobData, HLTBResponseItem } from "./hltb.types";
import { GamePlaytime } from "./entity/game-playtime.entity";
import { DeepPartial } from "typeorm";
import { Logger } from "@nestjs/common";

function parseResponse(
    gameId: number,
    response: HLTBResponseItem,
): DeepPartial<GamePlaytime> {
    return {
        gameId,
        sourceId: response.game_id,
        timeMain: response.comp_main,
        timePlus: response.comp_plus,
        time100: response.comp_100,
        timeAll: response.comp_all,
        createdAt: new Date(),
        // Essential
        updatedAt: new Date(),
    };
}

@Processor(HLTB_SYNC_QUEUE_NAME, {
    limiter: {
        max: 1,
        duration: 8000,
    },
})
export class HltbProcessor extends WorkerHostProcessor {
    logger = new Logger(HltbProcessor.name);
    constructor(
        private readonly hltbService: HltbService,
        private readonly hltbSearchService: HltbSearchService,
    ) {
        super();
    }

    async process(job: Job<HLTBJobData>) {
        if (job.name === HLTB_SYNC_QUEUE_JOB_NAME) {
            let searchResponse: HLTBResponseItem;
            try {
                searchResponse = await this.hltbSearchService.getFirst(
                    job.data.name,
                );
            } catch (err) {
                this.logger.warn(`${job.data.gameId} - ${err}`);
                return;
            }

            const parsedResponse = parseResponse(
                job.data.gameId,
                searchResponse,
            );
            await this.hltbService.save(parsedResponse);
            return job.data.gameId;
        }
    }
}
