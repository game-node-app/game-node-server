import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import {
    RECAP_CREATE_JOB_NAME,
    RECAP_GOAL_REMINDER_JOB_NAME,
    RECAP_QUEUE_NAME,
} from "../recap.constants";

@Injectable()
export class RecapQueueService {
    private readonly logger = new Logger(RecapQueueService.name);

    constructor(@InjectQueue(RECAP_QUEUE_NAME) private readonly queue: Queue) {
        this.registerRecapJobs();
    }

    private async registerRecapJobs() {
        Promise.all([
            this.queue.upsertJobScheduler(RECAP_CREATE_JOB_NAME, {
                // “At 04:00 UTC every day.”
                pattern: "0 4 * * *",
            }),
            this.queue.upsertJobScheduler(RECAP_GOAL_REMINDER_JOB_NAME, {
                // “At 12:00 UTC on 1 July.”
                pattern: "0 12 1 7 *",
                tz: "UTC",
            }),
        ])
            .then(() => {
                this.logger.log("Yearly recap job schedulers registered.");
            })
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
