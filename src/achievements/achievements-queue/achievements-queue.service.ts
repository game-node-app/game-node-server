import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
    ACHIEVEMENTS_BACKFILL_JOB_NAME,
    ACHIEVEMENTS_BACKFILL_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
    ACHIEVEMENTS_TRACKING_DELAY_MS,
    AchievementsBackfillJob,
    AchievementsQueueJob,
} from "./achievements-queue.constants";
import { Queue } from "bullmq";

@Injectable()
export class AchievementsQueueService {
    constructor(
        @InjectQueue(ACHIEVEMENTS_QUEUE_NAME)
        private readonly achievementQueue: Queue<AchievementsQueueJob>,
        @InjectQueue(ACHIEVEMENTS_BACKFILL_QUEUE_NAME)
        private readonly backfillQueue: Queue<AchievementsBackfillJob>,
    ) {}

    /**
     * Schedules the evaluation of a metric for a user. Should be called after the action that changed it commits.
     */
    addTrackingJob(job: AchievementsQueueJob) {
        const queued = this.achievementQueue.add(
            ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
            job,
            {
                delay: ACHIEVEMENTS_TRACKING_DELAY_MS,
                // Dedup only while delayed, so facts committed during processing get a new job
                deduplication: {
                    id: `ach-${job.userId}-${job.metric}`,
                    ttl: ACHIEVEMENTS_TRACKING_DELAY_MS,
                },
            },
        );
        queued.catch((e) => console.error(e));
        return queued;
    }

    addBackfillJob(job: AchievementsBackfillJob) {
        return this.backfillQueue.add(ACHIEVEMENTS_BACKFILL_JOB_NAME, job, {
            jobId: `ach-backfill-${job.definitionId}-${job.generation}-${job.afterUserId ?? "start"}`,
        });
    }
}
