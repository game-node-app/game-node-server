import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";
import { RECAP_CREATE_JOB_NAME, RECAP_QUEUE_NAME } from "../recap.constants";

@Injectable()
export class RecapQueueService {
    private readonly logger = new Logger(RecapQueueService.name);

    constructor(@InjectQueue(RECAP_QUEUE_NAME) private readonly queue: Queue) {
        this.registerRecapJobs();
    }

    private async registerRecapJobs() {
        this.queue
            .upsertJobScheduler(RECAP_CREATE_JOB_NAME, {
                // “At 04:00 in December and January.”
                pattern: "0 4 * 12,1 *",
            })
            .then(() => {
                this.logger.log("Yearly recap job scheduler registered.");
            })
            .catch((err) => {
                this.logger.error(err);
            });
    }
}
