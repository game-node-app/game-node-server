import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import {
    DeepPartial,
    FindManyOptions,
    FindOneOptions,
    Repository,
} from "typeorm";
import {
    ActivityCreate,
    ActivityType,
} from "../activities-queue/activities-queue.constants";

@Injectable()
export class ActivitiesRepositoryService {
    private readonly logger = new Logger(ActivitiesRepositoryService.name);

    constructor(
        @InjectRepository(Activity)
        private activitiesRepository: Repository<Activity>,
    ) {}

    async create(dto: ActivityCreate) {
        const { type, sourceId, profileUserId } = dto;

        const activity = this.activitiesRepository.create({
            type,
            profileUserId,
        });

        switch (dto.type) {
            case ActivityType.COLLECTION_ENTRY:
                if (typeof sourceId !== "string") {
                    throw new Error(
                        "Collection Entry activities should have a string sourceId",
                    );
                }
                activity.collectionEntryId = sourceId;
                break;
            case ActivityType.REVIEW:
                if (typeof sourceId !== "string") {
                    throw new Error(
                        "Review activities should have a string sourceId",
                    );
                }
                activity.reviewId = sourceId;
                break;
            case ActivityType.FOLLOW:
                if (typeof sourceId !== "number") {
                    throw new Error(
                        "Collection Entry activities should have a number sourceId",
                    );
                }
                activity.userFollowId = sourceId;
                break;
            default:
                this.logger.error(
                    `Invalid activity type: ${JSON.stringify(dto)}`,
                );
                throw new Error(
                    `Invalid activity type: ${JSON.stringify(dto)}`,
                );
        }

        try {
            return await this.activitiesRepository.save(activity);
        } catch (e) {
            this.logger.error(
                "Invalid activity: " + JSON.stringify(dto) + "Aborting.",
            );
            this.logger.error(e);
        }
    }

    async findLatestBy(by: FindManyOptions<Activity>) {
        return await this.activitiesRepository.findAndCount({
            ...by,
            order: {
                createdAt: "DESC",
            },
        });
    }

    async findAllBy(by: FindManyOptions<Activity>) {
        return await this.activitiesRepository.findAndCount(by);
    }

    async findOneBy(by: FindOneOptions<Activity>) {
        return await this.activitiesRepository.findOne(by);
    }
}
