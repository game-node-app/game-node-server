import { Process, Processor } from "@nestjs/bull";
import {
    ACHIEVEMENTS_QUEUE_NAME,
    ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME,
    AchievementsQueueJob,
} from "./achievements-queue.constants";
import { Job } from "bull";
import { AchievementsService } from "../achievements.service";

@Processor(ACHIEVEMENTS_QUEUE_NAME)
export class AchievementsQueueProcessor {
    constructor(private readonly achievementsService: AchievementsService) {}

    @Process(ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME)
    async processTrackingJobs(job: Job<AchievementsQueueJob>) {
        return this.achievementsService.trackAchievementsProgress(
            job.data.targetUserId,
            job.data.category,
        );
    }
}
