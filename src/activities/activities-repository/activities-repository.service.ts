import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import {
    FindManyOptions,
    FindOneOptions,
    Repository,
    TypeORMError,
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
import { PostsService } from "../../posts/posts.service";

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
        private readonly postsService: PostsService,
    ) {}

    /**
     * Check if the activity can be created.
     * - user is not suspended/banned
     * - game is not excluded
     * - game is not nsfw <br >
     * <i>Duplicates are checked by unique constraints directly in DB.</i>
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
                const collectionEntry =
                    await this.collectionEntriesService.findOneByIdOrFail(
                        dto.sourceId as string,
                    );
                targetGameId = collectionEntry.gameId;
                break;
            }
            case ActivityType.REVIEW: {
                const review = await this.reviewsService.findOneByIdOrFail(
                    dto.sourceId as string,
                );
                targetGameId = review.gameId;
                break;
            }
            case ActivityType.POST:
                const post = await this.postsService.findOneByIdOrFail(
                    dto.sourceId as string,
                );
                targetGameId = post.gameId;
                break;
        }

        if (targetGameId == undefined) {
            return;
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
                activity.collectionEntryId = sourceId;
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
            case ActivityType.POST:
                if (typeof sourceId !== "string") {
                    throw new UnrecoverableError(
                        "Post activities should have a string sourceId",
                    );
                }
                activity.postId = sourceId;
                break;
            default:
                throw new UnrecoverableError(
                    `Invalid activity type: ${JSON.stringify(dto)}`,
                );
        }

        let persistedActivity: Activity;
        try {
            persistedActivity = await this.activitiesRepository.save(activity);
        } catch (err: unknown) {
            if (err instanceof TypeORMError) {
                if (err.message.includes("Duplicate entry")) {
                    throw new UnrecoverableError(
                        "Entry already has an associated activity.",
                    );
                }
            }
            throw err;
        }

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
