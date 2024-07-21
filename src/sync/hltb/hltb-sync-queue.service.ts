import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
    HLTB_SYNC_QUEUE_JOB_NAME,
    HLTB_SYNC_QUEUE_NAME,
} from "./hltb.constants";
import { Queue } from "bullmq";
import { HLTBJobData } from "./hltb.types";

@Injectable()
export class HltbSyncQueueService {
    constructor(
        @InjectQueue(HLTB_SYNC_QUEUE_NAME)
        private hltbQueue: Queue<HLTBJobData>,
    ) {}

    private getJobId(gameId: number) {
        return `hltb-queue-${gameId}`;
    }

    createPlaytimeInfo(gameId: number, gameName: string) {
        // Callbacks used to avoid having to use .then and .catch when calling the function.
        const data = {
            gameId,
            name: gameName,
        } satisfies HLTBJobData;

        this.hltbQueue
            .add(HLTB_SYNC_QUEUE_JOB_NAME, data, {
                // Jobs with duplicate ids will be ignored. This is what we want.
                jobId: this.getJobId(gameId),
            })
            .then()
            .catch(console.error);
    }
}
