import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Activity } from "./entities/activity.entity";
import {
    FindManyOptions,
    FindOneOptions,
    FindOptionsRelations,
    In,
    Not,
    Repository,
    TypeORMError,
} from "typeorm";
import {
    ActivityCreate,
    ActivityType,
} from "../activities-queue/activities-queue.constants";
import { StatisticsSourceType } from "../../statistics/statistics.constants";
import {
    createStatisticsTarget,
    ensureStatisticsTarget,
    findLikeSummaries,
} from "../../statistics/statistics-target.repository";
import { FindLatestActivitiesDto } from "./dto/find-latest-activities.dto";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";
import { GameFilterService } from "../../game/game-filter/game-filter.service";
import { AuthService } from "../../auth/auth.service";
import { ReviewsService } from "../../reviews/reviews.service";
import { CollectionsEntriesService } from "../../collections/collections-entries/collections-entries.service";
import { UnrecoverableError } from "bullmq";
import { PostsService } from "../../posts/posts.service";
import { GameAchievementActivityService } from "../../game/game-achievement/game-achievement-activity.service";
import { GameRepositoryService } from "../../game/game-repository/game-repository.service";
import { Game } from "../../game/game-repository/entities/game.entity";
import { ObtainedGameAchievementActivity } from "../../game/game-achievement/entity/obtained-game-achievement-activity.entity";
import {
    ActivityResponseDto,
    ActivityStatisticsSummaryDto,
} from "./dto/activity-response.dto";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";

const ACTIVITY_HYDRATION_RELATIONS: FindOptionsRelations<Activity> = {
    profile: {
        avatar: true,
    },
    collectionEntry: true,
    collection: true,
    review: true,
    userFollow: true,
    post: true,
    obtainedAchievement: {
        definition: true,
    },
};

@Injectable()
export class ActivitiesRepositoryService {
    private readonly logger = new Logger(ActivitiesRepositoryService.name);

    constructor(
        @InjectRepository(Activity)
        private activitiesRepository: Repository<Activity>,
        private readonly reviewsService: ReviewsService,
        private readonly collectionEntriesService: CollectionsEntriesService,
        private readonly gameFilterService: GameFilterService,
        private readonly authService: AuthService,
        private readonly postsService: PostsService,
        private readonly obtainedGameAchievementActivityService: GameAchievementActivityService,
        private readonly gameRepositoryService: GameRepositoryService,
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
        const lockout = (
            await this.authService.getLockoutStates([dto.profileUserId])
        ).get(dto.profileUserId);

        if (lockout?.isSuspended || lockout?.isBanned) {
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
            case ActivityType.OBTAINED_GAME_ACHIEVEMENT:
                const obtainedAchievement =
                    await this.obtainedGameAchievementActivityService.findOneByIdOrFail(
                        dto.sourceId as number,
                    );
                targetGameId = obtainedAchievement.externalGame?.gameId;
                break;
        }

        if (targetGameId == undefined) {
            return;
        }

        const isGameMature =
            await this.gameFilterService.isMature(targetGameId);
        if (isGameMature) {
            throw new UnrecoverableError(
                `Target game ${targetGameId} is excluded from front-facing content`,
            );
        }
    }

    private findExistingAchievementActivity(dto: ActivityCreate) {
        if (
            dto.type !== ActivityType.OBTAINED_GAME_ACHIEVEMENT ||
            typeof dto.sourceId !== "number"
        )
            return Promise.resolve(null);
        return this.activitiesRepository.findOneBy({
            profileUserId: dto.profileUserId,
            type: dto.type,
            obtainedGameAchievementActivityId: dto.sourceId,
        });
    }

    async create(dto: ActivityCreate) {
        const existingActivity =
            await this.findExistingAchievementActivity(dto);
        if (existingActivity) {
            await this.activitiesRepository.manager.transaction((manager) =>
                ensureStatisticsTarget(manager, StatisticsSourceType.ACTIVITY, existingActivity.id).then(() => undefined),
            );
            return existingActivity;
        }

        await this.validateCreate(dto);

        const { type, sourceId, complementarySourceId, profileUserId } = dto;

        const activity = this.activitiesRepository.create({
            type,
            profileUserId,
        });

        switch (dto.type) {
            case ActivityType.COLLECTION_ENTRY:
                if (
                    typeof sourceId !== "string" ||
                    typeof complementarySourceId !== "string"
                ) {
                    throw new UnrecoverableError(
                        "CollectionEntry activities should have a string sourceId",
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
            case ActivityType.POST:
                if (typeof sourceId !== "string") {
                    throw new UnrecoverableError(
                        "Post activities should have a string sourceId",
                    );
                }
                activity.postId = sourceId;
                break;
            case ActivityType.OBTAINED_GAME_ACHIEVEMENT:
                if (typeof sourceId !== "number") {
                    throw new UnrecoverableError(
                        "Obtained Game Achievement activities should have a number sourceId",
                    );
                }
                activity.obtainedGameAchievementActivityId = sourceId;
                break;
            case ActivityType.ACHIEVEMENT_UNLOCKED:
                if (typeof sourceId !== "number") {
                    throw new UnrecoverableError(
                        "Achievement unlocked activities should have a number sourceId",
                    );
                }
                activity.obtainedAchievementId = sourceId;
                break;
            default:
                throw new UnrecoverableError(
                    `Invalid activity type: ${JSON.stringify(dto)}`,
                );
        }

        let persistedActivity: Activity;
        try {
            persistedActivity = await this.activitiesRepository.manager.transaction(async (manager) => {
                activity.statisticsTargetId = await createStatisticsTarget(manager, StatisticsSourceType.ACTIVITY);
                const saved = await manager.getRepository(Activity).save(activity);
                return saved;
            });
        } catch (err: unknown) {
            if (err instanceof TypeORMError) {
                if (err.message.includes("Duplicate entry")) {
                    const existingActivity =
                        await this.findExistingAchievementActivity(dto);
                    if (existingActivity) {
                        await this.activitiesRepository.manager.transaction((manager) =>
                            ensureStatisticsTarget(manager, StatisticsSourceType.ACTIVITY, existingActivity.id).then(() => undefined),
                        );
                        return existingActivity;
                    }
                    throw new UnrecoverableError(
                        "Entry already has an associated activity.",
                    );
                }
            }
            throw err;
        }
        return persistedActivity;
    }

    private getTargetGameId(activity: Activity): number | null {
        const rawGameId =
            activity.collectionEntry?.gameId ??
            activity.review?.gameId ??
            activity.post?.gameId ??
            activity.obtainedGameAchievementActivity?.externalGame?.gameId;
        if (rawGameId == null) {
            return null;
        }
        return Number(rawGameId);
    }

    private async hydrate(
        activities: Activity[],
        viewerUserId?: string,
    ): Promise<ActivityResponseDto[]> {
        if (activities.length === 0) {
            return [];
        }

        // TypeORM 0.3 RelationIdLoader drops 64+ char aliases when every row matches (single-row / filtered pages).
        const ogActivityIds = Array.from(
            new Set(
                activities
                    .map((activity) => activity.obtainedGameAchievementActivityId)
                    .filter((id): id is number => id != null),
            ),
        );
        if (ogActivityIds.length > 0) {
            const ogActivities = await this.activitiesRepository.manager
                .getRepository(ObtainedGameAchievementActivity)
                .find({
                    where: { id: In(ogActivityIds) },
                    relations: { externalGame: true },
                });
            const ogById = new Map<number, ObtainedGameAchievementActivity>(
                ogActivities.map((item) => [Number(item.id), item]),
            );
            for (const activity of activities) {
                activity.obtainedGameAchievementActivity =
                    activity.obtainedGameAchievementActivityId != null
                        ? (ogById.get(
                              Number(activity.obtainedGameAchievementActivityId),
                          ) ?? null)
                        : null;
            }
        } else {
            for (const activity of activities) {
                activity.obtainedGameAchievementActivity = null;
            }
        }

        const gameIds = Array.from(
            new Set(
                activities
                    .map((activity) => this.getTargetGameId(activity))
                    .filter(
                        (gameId): gameId is number =>
                            gameId != null && Number.isSafeInteger(gameId),
                    ),
            ),
        );

        let games: Game[] = [];
        if (gameIds.length > 0) {
            try {
                games = await this.gameRepositoryService.findAllByIds({
                    gameIds,
                    relations: { cover: true },
                });
            } catch (error) {
                if (
                    error instanceof HttpException &&
                    error.getStatus() === HttpStatus.NOT_FOUND
                ) {
                    games = [];
                } else {
                    throw error;
                }
            }
        }
        const gamesById = new Map<number, Game>(
            games.map((game) => [Number(game.id), game]),
        );

        const targetIds = Array.from(
            new Set(
                activities
                    .map((activity) => activity.statisticsTargetId)
                    .filter((id): id is number => id != null),
            ),
        );

        const likeSummaries =
            targetIds.length > 0
                ? await findLikeSummaries(
                      this.activitiesRepository.manager,
                      targetIds,
                      viewerUserId,
                  )
                : new Map<string, ActivityStatisticsSummaryDto>();

        return activities.map((activity) => {
            if (
                activity.collection &&
                !activity.collection.isPublic &&
                activity.collection.libraryUserId !== viewerUserId
            ) {
                activity.collection = null;
            }
            if (activity.obtainedGameAchievementActivity) {
                delete (
                    activity.obtainedGameAchievementActivity as Partial<ObtainedGameAchievementActivity>
                ).pendingDelivery;
            }

            const gameId = this.getTargetGameId(activity);
            const game =
                gameId != null ? (gamesById.get(gameId) ?? null) : null;
            const statistics: ActivityStatisticsSummaryDto =
                activity.statisticsTargetId != null
                    ? (likeSummaries.get(String(activity.statisticsTargetId)) ?? {
                          likesCount: 0,
                          isLiked: false,
                      })
                    : { likesCount: 0, isLiked: false };

            return Object.assign(activity, { game, statistics });
        });
    }

    async findLatestBy(
        by: FindManyOptions<Activity>,
        viewerUserId?: string,
    ): Promise<TPaginationData<ActivityResponseDto>> {
        const [activities, count] = await this.activitiesRepository.findAndCount({
            ...by,
            relations: ACTIVITY_HYDRATION_RELATIONS,
            relationLoadStrategy: "query",
            order: {
                createdAt: "DESC",
            },
        });
        const hydrated = await this.hydrate(activities, viewerUserId);
        return [hydrated, count];
    }

    async findAllBy(by: FindManyOptions<Activity>) {
        return await this.activitiesRepository.findAndCount(by);
    }

    async findOneBy(by: FindOneOptions<Activity>) {
        return await this.activitiesRepository.findOne(by);
    }

    async findOneByOrFail(
        by: FindOneOptions<Activity>,
        viewerUserId?: string,
    ): Promise<ActivityResponseDto> {
        const activity = await this.activitiesRepository.findOneOrFail({
            ...by,
            relations: ACTIVITY_HYDRATION_RELATIONS,
            relationLoadStrategy: "query",
        });
        const [hydrated] = await this.hydrate([activity], viewerUserId);
        return hydrated;
    }

    async findLatestExcludingTypes(
        dto: FindLatestActivitiesDto,
        excludedTypes: ActivityType[],
        viewerUserId?: string,
    ) {
        const baseFindOptions = buildBaseFindOptions(dto);
        return await this.findLatestBy(
            {
                ...baseFindOptions,
                where: [
                    {
                        profileUserId: dto.userId,
                        type: dto.type,
                    },
                    {
                        profileUserId: dto.userId,
                        type: Not(In(excludedTypes)),
                    },
                ],
            },
            viewerUserId,
        );
    }

    async findLatest(dto: FindLatestActivitiesDto, viewerUserId?: string) {
        const baseFindOptions = buildBaseFindOptions(dto);
        return await this.findLatestBy(
            {
                ...baseFindOptions,
                where: {
                    profileUserId: dto.userId,
                    type: dto.type,
                },
            },
            viewerUserId,
        );
    }
}
