import { Injectable } from "@nestjs/common";
import { HltbSyncService } from "./hltb-sync.service";
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
        private readonly hltbService: HltbSyncService,
    ) {}

    private getJobId(gameId: number) {
        return `hltb-queue-${gameId}`;
    }

    /**
     * Jobs are automatically removed once complete. This function returns a boolean
     * indicating that a gameId has a job in queue.
     * @param gameId
     * @private
     */
    private async hasPendingJob(gameId: number): Promise<boolean> {
        const job = await this.hltbQueue.getJob(this.getJobId(gameId));
        return job != undefined;
    }

    createPlaytimeInfo(gameId: number, gameName: string) {
        // Callbacks used to avoid having to use .then and .catch when calling the function.
        this.hasPendingJob(gameId).then((hasPendingJob) => {
            if (hasPendingJob) return;
            this.hltbService.isEligibleForUpdate(gameId).then((isEligible) => {
                if (isEligible) {
                    const data = {
                        gameId,
                        name: gameName,
                    } satisfies HLTBJobData;
                    this.hltbQueue
                        .add(HLTB_SYNC_QUEUE_JOB_NAME, data, {
                            jobId: this.getJobId(gameId),
                        })
                        .then()
                        .catch(console.error);
                }
            });
        });
    }
}
