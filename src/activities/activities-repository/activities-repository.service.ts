import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import {
    FindManyOptions,
    FindOneOptions,
    QueryFailedError,
    Repository,
} from "typeorm";
import {
    ActivityCreate,
    ActivityType,
} from "../activities-queue/activities-queue.constants";
import { StatisticsQueueService } from "../../statistics/statistics-queue/statistics-queue.service";
import { StatisticsSourceType } from "../../statistics/statistics.constants";

@Injectable()
export class ActivitiesRepositoryService {
    private readonly logger = new Logger(ActivitiesRepositoryService.name);

    constructor(
        @InjectRepository(Activity)
        private activitiesRepository: Repository<Activity>,
        private readonly statisticsQueueService: StatisticsQueueService,
    ) {}

    async create(dto: ActivityCreate) {
        const { type, sourceId, complementarySourceId, profileUserId } = dto;

        const activity = this.activitiesRepository.create({
            type,
            profileUserId,
        });

        switch (dto.type) {
            case ActivityType.COLLECTION_ENTRY:
                if (typeof sourceId !== "string") {
                    throw new Error(
                        "CollectionEntry activities should have a string sourceId",
                    );
                }
                if (typeof complementarySourceId !== "string") {
                    throw new Error(
                        "A string complementarySourceId must be specified for CollectionEntry activities",
                    );
                }
                activity.collectionEntryId = sourceId;
                activity.collectionId = complementarySourceId;
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
            const persistedActivity =
                await this.activitiesRepository.save(activity);

            this.statisticsQueueService.createStatistics({
                sourceId: persistedActivity.id,
                sourceType: StatisticsSourceType.ACTIVITY,
            });
        } catch (e) {
            /**
             * One of the unique constraints likely failed
             */
            if (e instanceof QueryFailedError) {
                this.logger.warn(`Skipping attempt to re-insert activity`);
            }
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
