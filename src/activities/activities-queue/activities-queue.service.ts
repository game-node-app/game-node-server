import { InjectQueue } from "@nestjs/bull";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bull";
import { ActivityCreate } from "./activities-queue.constants";

@Injectable()
export class ActivitiesQueueService {
    private readonly logger = new Logger(ActivitiesQueueService.name);
    constructor(
        @InjectQueue("activities") private readonly activitiesQueue: Queue,
    ) {}

    async addActivity(activity: ActivityCreate) {
        if (activity.profileUserId == null) {
            this.logger.error("An activity must have an associated profile");
            throw new Error("An activity must have an associated profile.");
        } else if (
            activity.sourceId == undefined ||
            typeof activity.sourceId !== "string"
        ) {
            this.logger.error("Activity must have a valid sourceId.");
            throw new Error("Activity must have a valid sourceId.");
        }
        return await this.activitiesQueue.add("addActivity", activity);
    }

    async deleteActivity(sourceId: string) {
        try {
            return await this.activitiesQueue.add("deleteActivity", sourceId);
        } catch (e) {
            console.error(e);
        }
    }
}
