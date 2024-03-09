import { Injectable } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import {
    ACHIEVEMENTS_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
    AchievementsQueueJob,
} from "./achievements-queue.constants";
import { Queue } from "bullmq";

@Injectable()
export class AchievementsQueueService {
    constructor(
        @InjectQueue(ACHIEVEMENTS_QUEUE_NAME)
        private readonly achievementQueue: Queue<AchievementsQueueJob>,
    ) {}

    /**
     * A new job should be added to each category of Achievements that the caller wants to verify.
     * @param job
     */
    addTrackingJob(job: AchievementsQueueJob) {
        this.achievementQueue
            .add(ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME, job)
            .then()
            .catch((e) => console.error(e));
    }
}
