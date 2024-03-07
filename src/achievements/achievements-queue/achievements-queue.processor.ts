import { Processor, WorkerHost } from "@nestjs/bullmq";
import {
    ACHIEVEMENTS_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
    AchievementsQueueJob,
} from "./achievements-queue.constants";
import { Job } from "bullmq";
import { AchievementsService } from "../achievements.service";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";

@Processor(ACHIEVEMENTS_QUEUE_NAME)
export class AchievementsQueueProcessor extends WorkerHostProcessor {
    constructor(private readonly achievementsService: AchievementsService) {
        super();
    }

    async process(job: Job<AchievementsQueueJob>): Promise<void> {
        switch (job.name) {
            case ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME:
                return this.achievementsService.trackAchievementsProgress(
                    job.data.targetUserId,
                    job.data.category,
                );
        }
    }
}
