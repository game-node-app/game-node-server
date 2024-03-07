import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Activity } from "../activities-repository/entities/activity.entity";
import { Job } from "bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { ActivitiesRepositoryService } from "../activities-repository/activities-repository.service";
import { WorkerHostProcessor } from "../../utils/WorkerHostProcessor";

@Processor("activities")
@Injectable()
export class ActivitiesQueueProcessor extends WorkerHostProcessor {
    logger = new Logger(ActivitiesQueueProcessor.name);

    constructor(
        private activitiesRepositoryService: ActivitiesRepositoryService,
    ) {
        super();
    }

    async process(job: Job<Activity | string>) {
        if (job.name === "addActivity") {
            try {
                await this.activitiesRepositoryService.create(
                    job.data as Activity,
                );
            } catch (e) {
                this.logger.error("Error while processing activity: ", e);
                this.logger.log("This error happened for data: ", job.data);
            }
        } else if (job.name === "deleteActivity") {
            try {
                const sourceId = job.data;
                await this.activitiesRepositoryService.deleteBySourceId(
                    sourceId as string,
                );
            } catch (e) {
                this.logger.error("Error while deleting activity: ", e);
                this.logger.log("This error happened for data: ", job.data);
            }
        }
    }
}
