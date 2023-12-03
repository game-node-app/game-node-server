import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import {
    DeepPartial,
    FindManyOptions,
    FindOneOptions,
    Repository,
} from "typeorm";

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
            return;
        }
        this.logger.warn(
            "Invalid activity: " + JSON.stringify(activityLike) + "Aborting.",
        );
    }

    async deleteBySourceId(sourceId: string) {
        return await this.activitiesRepository.delete({
            sourceId,
        });
    }

    async findLatestBy(by: FindManyOptions<Activity>) {
        return await this.activitiesRepository.findAndCount({
            ...by,
            order: {
                createdAt: "DESC",
            },
        });
    }

    async findOneBy(by: FindOneOptions<Activity>) {
        return await this.activitiesRepository.findOne({
            ...by,
        });
    }
}
