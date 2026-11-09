import { Processor } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import {
    PROFILE_VIDEO_QUEUE_NAME,
    ProfileVideoJobData,
} from "./profile-video.constants";
import { ProfileVideoService } from "./profile-video.service";

@Processor(PROFILE_VIDEO_QUEUE_NAME, { concurrency: 1 })
export class ProfileVideoProcessor extends WorkerHostProcessor {
    constructor(private readonly profileVideoService: ProfileVideoService) {
        super();
    }

    async process(job: Job<ProfileVideoJobData>) {
        await this.profileVideoService.process(job.data);
    }
}
