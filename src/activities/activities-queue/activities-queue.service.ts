import { InjectQueue } from "@nestjs/bull";
import { Injectable } from "@nestjs/common";
import { Queue } from "bull";
import { Activity } from "../activities-repository/entities/activity.entity";
import { DeepPartial } from "typeorm";

@Injectable()
export class ActivitiesQueueService {
    constructor(
        @InjectQueue("activities") private readonly activitiesQueue: Queue,
    ) {}

    async addActivity(activity: DeepPartial<Activity>) {
        if (typeof activity.profile == undefined) {
            throw new Error("An activity must have an associated profile.");
        } else if (
            activity.sourceId == undefined ||
            typeof activity.sourceId !== "string"
        ) {
            throw new Error("Activity must have a valid sourceId.");
        }
        await this.activitiesQueue.add("addActivity", activity);
    }

    async deleteActivity(sourceId: string) {
        try {
            await this.activitiesQueue.add("deleteActivity", sourceId);
        } catch (e) {
            console.error(e);
        }
    }
}
