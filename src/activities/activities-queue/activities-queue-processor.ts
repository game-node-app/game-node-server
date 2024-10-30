import { Processor } from "@nestjs/bullmq";
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
            await this.activitiesRepositoryService.create(job.data);
        }
    }
}
