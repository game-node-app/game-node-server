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

    async create(activityLike: DeepPartial<Activity>) {
        try {
            return await this.activitiesRepository.save(activityLike);
        } catch (e) {
            this.logger.error(
                "Invalid activity: " +
                    JSON.stringify(activityLike) +
                    "Aborting.",
            );
            this.logger.error(e);
        }
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
