import { Injectable, Logger } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { AWARDS_RESULT_QUEUE_NAME } from "./constants";
import { Queue } from "bullmq";

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
            .upsertJobScheduler("awards-result-scheduler", {
                pattern: "0 0,6,12,18 * * *",
            })
            .then(() => {
                this.logger.log("Awards result scheduler registered.");
            })
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
