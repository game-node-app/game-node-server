import { Processor } from "@nestjs/bullmq";
import { Activity } from "../activities-repository/entities/activity.entity";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { ActivitiesRepositoryService } from "../activities-repository/activities-repository.service";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";
import { ActivityCreate } from "./activities-queue.constants";

@Processor("activities")
@Injectable()
export class ActivitiesQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(ActivitiesQueueProcessor.name);

    constructor(
        private activitiesRepositoryService: ActivitiesRepositoryService,
    ) {
        super();
    }

    async process(job: Job<ActivityCreate>) {
        if (job.name === "register") {
            try {
                await this.activitiesRepositoryService.create(job.data);
            } catch (e) {
                this.logger.error("Error while processing activity: ", e);
                this.logger.log("This error happened for data: ", job.data);
                // Errors must be thrown, otherwise BullMQ will not try to
                // re-run this job
                throw e;
            }
        }
    }
}
