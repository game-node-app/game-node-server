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
import { FindLatestActivitiesDto } from "./dto/find-latest-activities.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { GameFilterService } from "../../game/game-filter/game-filter.service";
import { SuspensionService } from "../../suspension/suspension.service";
import { ReviewsService } from "../../reviews/reviews.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { UnrecoverableError } from "bullmq";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";

@Injectable()
export class ActivitiesRepositoryService {
    private readonly logger = new Logger(ActivitiesRepositoryService.name);

    constructor(
        @InjectRepository(Activity)
        private activitiesRepository: Repository<Activity>,
        private readonly statisticsQueueService: StatisticsQueueService,
        private readonly reviewsService: ReviewsService,
        private readonly collectionEntriesService: CollectionsEntriesService,
        private readonly gameFilterService: GameFilterService,
        private readonly suspensionService: SuspensionService,
    ) {}

    /**
     * Check if the activity can be created.
     * - target entry really exists
     * - user is not suspended/banned
     * - game is not excluded
     * - game is not nsfw
     * @param dto
     * @private
     */
    private async validateCreate(dto: ActivityCreate) {
        const isSuspendedOrBanned =
            await this.suspensionService.checkIsSuspendedOrBanned(
                dto.profileUserId,
            );
        if (isSuspendedOrBanned) {
            throw new UnrecoverableError("User is suspended or banned.");
        }

        let targetGameId: number | undefined = undefined;
        switch (dto.type) {
            case ActivityType.COLLECTION_ENTRY: {
                if (typeof dto.sourceId !== "string") {
                    throw new UnrecoverableError(
                        "Invalid sourceId type for collectionEntry activity",
                    );
                }
                const collectionEntry =
                    await this.collectionEntriesService.findOneByIdOrFail(
                        dto.sourceId,
                    );

                targetGameId = collectionEntry.gameId;
                break;
            }
            case ActivityType.REVIEW: {
                if (typeof dto.sourceId !== "string") {
                    throw new UnrecoverableError(
                        "Invalid sourceId type for review activity",
                    );
                }
                const review = await this.reviewsService.findOneByIdOrFail(
                    dto.sourceId,
                );
                targetGameId = review.gameId;
                break;
            }
        }

        if (targetGameId == undefined) {
            return;
        }

        const isGameExcluded =
            await this.gameFilterService.isExcluded(targetGameId);
        if (isGameExcluded) {
            throw new UnrecoverableError(
                "Target game is excluded from front-facing content",
            );
        }

        const isGameMature =
            await this.gameFilterService.isMature(targetGameId);
        if (isGameMature) {
            throw new UnrecoverableError(
                "Target game is excluded from front-facing content",
            );
        }
    }

    async create(dto: ActivityCreate) {
        await this.validateCreate(dto);

        const { type, sourceId, complementarySourceId, profileUserId } = dto;

        const activity = this.activitiesRepository.create({
            type,
            profileUserId,
        });

        switch (dto.type) {
            case ActivityType.COLLECTION_ENTRY:
                if (typeof sourceId !== "string") {
                    throw new UnrecoverableError(
                        "CollectionEntry activities should have a string sourceId",
                    );
                }
                if (typeof complementarySourceId !== "string") {
                    throw new UnrecoverableError(
                        "A string complementarySourceId must be specified for CollectionEntry activities",
                    );
                }
                activity.collectionEntryId = sourceId;
                activity.collectionId = complementarySourceId;
                break;
            case ActivityType.REVIEW:
                if (typeof sourceId !== "string") {
                    throw new UnrecoverableError(
                        "Review activities should have a string sourceId",
                    );
                }
                activity.reviewId = sourceId;
                break;
            case ActivityType.FOLLOW:
                if (typeof sourceId !== "number") {
                    throw new UnrecoverableError(
                        "Follow activities should have a number sourceId",
                    );
                }
                activity.userFollowId = sourceId;
                break;
            default:
                throw new UnrecoverableError(
                    `Invalid activity type: ${JSON.stringify(dto)}`,
                );
        }

        const persistedActivity =
            await this.activitiesRepository.save(activity);

        this.statisticsQueueService.createStatistics({
            sourceId: persistedActivity.id,
            sourceType: StatisticsSourceType.ACTIVITY,
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

    async findAllBy(by: FindManyOptions<Activity>) {
        return await this.activitiesRepository.findAndCount(by);
    }

    async findOneBy(by: FindOneOptions<Activity>) {
        return await this.activitiesRepository.findOne(by);
    }

    async findOneByOrFail(by: FindOneOptions<Activity>) {
        return await this.activitiesRepository.findOneOrFail(by);
    }

    async findLatest(dto: FindLatestActivitiesDto) {
        const baseFindOptions = buildBaseFindOptions(dto);
        return await this.findLatestBy({
            ...baseFindOptions,
            where: {
                profileUserId: dto.userId,
            },
        });
    }
}
