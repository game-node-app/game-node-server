import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Queue } from "bullmq";
import { ActivityCreate } from "./activities-queue.constants";

@Injectable()
export class ActivitiesQueueService {
    private readonly logger = new Logger(ActivitiesQueueService.name);

    constructor(
        @InjectQueue("activities") private readonly activitiesQueue: Queue,
    ) {}

    register(activity: ActivityCreate) {
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
        this.activitiesQueue
            .add("register", activity)
            .then()
            .catch((e) => this.logger.error(e));
    }
}
