import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { AWARDS_RESULT_QUEUE_NAME } from "./constants";
import { Queue } from "bullmq";

export const AWARDS_RESULT_SCHEDULER_ID = "awards-result-scheduler";
export const AWARDS_RESULT_SCHEDULER_PATTERN = "0 * * * *";

@Injectable()
export class AwardsResultQueue {
    private logger = new Logger(AwardsResultQueue.name);

    constructor(
        @InjectQueue(AWARDS_RESULT_QUEUE_NAME) private readonly queue: Queue,
    ) {
        this.registerResultJob();
    }

    private registerResultJob() {
        this.queue
            .upsertJobScheduler(AWARDS_RESULT_SCHEDULER_ID, {
                // Hourly lifecycle tick; same id replaces the old 6-hourly job.
                pattern: AWARDS_RESULT_SCHEDULER_PATTERN,
            })
            .then(() => {
                this.logger.log("Awards result scheduler registered.");
            })
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
