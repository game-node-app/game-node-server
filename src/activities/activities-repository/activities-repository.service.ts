import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import { DeepPartial, Repository } from "typeorm";

@Injectable()
export class ActivitiesRepositoryService {
    private readonly logger = new Logger(ActivitiesRepositoryService.name);

    constructor(
        @InjectRepository(Activity)
        private activitiesRepository: Repository<Activity>,
    ) {}

    private isValidActivity(activity: DeepPartial<Activity>): boolean {
        return (
            activity.sourceId != undefined &&
            activity.profile != undefined &&
            activity.profile.userId != undefined
        );
    }

    async create(activityLike: DeepPartial<Activity>) {
        if (this.isValidActivity(activityLike)) {
            await this.activitiesRepository.save(activityLike);
        }
        this.logger.warn("Invalid activity: " + JSON.stringify(activityLike));
    }

    async findLatest(limit?: number) {
        return await this.activitiesRepository.find({
            order: {
                createdAt: "DESC",
            },
            take: limit || 20,
        });
    }
}
