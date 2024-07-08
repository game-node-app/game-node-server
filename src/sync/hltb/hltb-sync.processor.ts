import { Processor } from "@nestjs/bullmq";
import {
    HLTB_SYNC_QUEUE_JOB_NAME,
    HLTB_SYNC_QUEUE_NAME,
} from "./hltb.constants";
import { HltbSyncService } from "./hltb-sync.service";
import { HltbSyncSearchService } from "./hltb-sync-search.service";
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

/**
 * Attempt to improve the chances of successfully finding a game by removing
 * non-essential words (e.g. 'Complete Edition').
 * @param gameName
 */
function parseGameName(gameName: string) {
    if (gameName.includes(" -")) {
        const breakPoint = gameName.indexOf(" -");
        return gameName.slice(0, breakPoint);
    } else if (gameName.includes(": ")) {
        const breakPoint = gameName.indexOf(": ");
        return gameName.slice(0, breakPoint);
    }

    if (gameName.split(" ").length >= 3) {
        const subStrings = gameName.split(" ");
        return subStrings.slice(0, 4).join(" ");
    }

    return gameName;
}

@Processor(HLTB_SYNC_QUEUE_NAME, {
    limiter: {
        max: 1,
        duration: 2000,
    },
})
export class HltbSyncProcessor extends WorkerHostProcessor {
    logger = new Logger(HltbSyncProcessor.name);
    constructor(
        private readonly hltbService: HltbSyncService,
        private readonly hltbSearchService: HltbSyncSearchService,
    ) {
        super();
    }

    async process(job: Job<HLTBJobData>) {
        if (job.name === HLTB_SYNC_QUEUE_JOB_NAME) {
            let searchResponse: HLTBResponseItem;
            try {
                const parsedGameName = parseGameName(job.data.name);
                searchResponse =
                    await this.hltbSearchService.getFirst(parsedGameName);
            } catch (err) {
                this.logger.warn(`${job.data.gameId} - ${err}`);
                this.hltbService.registerFailedAttempt(job.data.gameId);
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
