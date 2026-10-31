import { Processor } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { AchievementsProgressService } from "../achievements-progress.service";
import { AchievementsQueueService } from "./achievements-queue.service";
import {
    ACHIEVEMENTS_BACKFILL_QUEUE_NAME,
    AchievementsBackfillJob,
} from "./achievements-queue.constants";

/**
 * Runs one batch per job and chains the next, so a restart resumes from the pending job.
 * Concurrency 1 avoids contention on tier counters.
 */
@Processor(ACHIEVEMENTS_BACKFILL_QUEUE_NAME, { concurrency: 1 })
export class AchievementsBackfillProcessor extends WorkerHostProcessor {
    constructor(
        private readonly achievementsProgressService: AchievementsProgressService,
        private readonly achievementsQueueService: AchievementsQueueService,
    ) {
        super();
    }

    async process(job: Job<AchievementsBackfillJob>): Promise<void> {
        const next = await this.achievementsProgressService.backfill(
            job.data.definitionId,
            job.data.afterUserId,
        );
        if (next) {
            await this.achievementsQueueService.addBackfillJob({
                ...job.data,
                afterUserId: next,
            });
        }
    }
}
