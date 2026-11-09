import { InjectQueue } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import {
    ProfileVideoJobData,
    PROFILE_VIDEO_JOB_NAME,
    PROFILE_VIDEO_QUEUE_NAME,
} from "./profile-video.constants";

@Injectable()
export class ProfileVideoQueueService {
    constructor(
        @InjectQueue(PROFILE_VIDEO_QUEUE_NAME)
        private readonly queue: Queue<ProfileVideoJobData>,
    ) {}

    add(job: ProfileVideoJobData) {
        return this.queue.add(PROFILE_VIDEO_JOB_NAME, job);
    }
}
