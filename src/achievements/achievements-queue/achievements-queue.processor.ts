import { Processor } from "@nestjs/bullmq";
import {
    ACHIEVEMENTS_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
    AchievementsQueueJob,
} from "./achievements-queue.constants";
import { Job } from "bullmq";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { AchievementsProgressService } from "../achievements-progress.service";

@Processor(ACHIEVEMENTS_QUEUE_NAME)
export class AchievementsQueueProcessor extends WorkerHostProcessor {
    constructor(
        private readonly achievementsProgressService: AchievementsProgressService,
    ) {
        super();
    }

    async process(job: Job<AchievementsQueueJob>): Promise<void> {
        if (job.name === ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME) {
            await this.achievementsProgressService.evaluate(
                job.data.userId,
                job.data.metric,
            );
        }
    }
}
