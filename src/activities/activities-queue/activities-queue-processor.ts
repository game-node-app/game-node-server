import { Process, Processor } from "@nestjs/bull";
import { Activity } from "../activities-repository/entities/activity.entity";
import { Job } from "bull";
import { Injectable, Logger } from "@nestjs/common";
import { ActivitiesRepositoryService } from "../activities-repository/activities-repository.service";

@Processor("activities")
@Injectable()
export class ActivitiesQueueProcessor {
    private readonly logger = new Logger(ActivitiesQueueProcessor.name);

    constructor(
        private activitiesRepositoryService: ActivitiesRepositoryService,
    ) {}

    @Process("addActivity")
    async addActivity(job: Job<Activity>) {
        try {
            await this.activitiesRepositoryService.create(job.data);
        } catch (e) {
            this.logger.error("Error while processing activity: ", e);
            this.logger.log("This error happened for data: ", job.data);
        }
    }

    @Process("deleteActivity")
    async removeActivity(job: Job<string>) {
        try {
            const sourceId = job.data;
            await this.activitiesRepositoryService.deleteBySourceId(sourceId);
        } catch (e) {
            this.logger.error("Error while deleting activity: ", e);
            this.logger.log("This error happened for data: ", job.data);
        }
    }
}
