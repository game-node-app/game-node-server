import {
    BadRequestException,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import { DataSource, EntityManager, EntityTarget, Repository } from "typeorm";
import {
    StatisticsCreateAction,
    StatisticsViewAction,
} from "./statistics-queue/statistics-queue.types";
import { AnyStatistics } from "./statistics.types";
import {
    StatisticsActionType,
    StatisticsSourceType,
} from "./statistics.constants";
import { ReviewStatistics } from "./entity/review-statistics.entity";
import { GameStatistics } from "./entity/game-statistics.entity";
import { ActivityStatistics } from "./entity/activity-statistics.entity";
import { CommentStatistics } from "./entity/comment-statistics.entity";
import { UserLike } from "./entity/user-like.entity";
import { UserView } from "./entity/user-view.entity";
import { StatisticsStatus } from "./dto/statistics-entity.dto";
import { PostStatistics } from "./entity/post-statistics.entity";
import { match, P } from "ts-pattern";
import {
    lockNotificationRoot,
    lockNotificationComment,
    NotificationRootType,
} from "../notifications/notifications-lifecycle.service";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import {
    ReactionRequestDto,
    ReactionResponseDto,
} from "./dto/reaction-request.dto";

/** Import-only, transaction-scoped initialization. Unique gameId preserves counters on replay. */
export async function ensureGameStatistics(
    manager: EntityManager,
    gameId: number,
): Promise<void> {
    await manager
        .createQueryBuilder()
        .insert()
        .into(GameStatistics)
        .values({ gameId })
        .orIgnore()
        .updateEntity(false)
        .execute();
}

@Injectable()
export class StatisticsService {
    private readonly logger = new Logger(StatisticsService.name);
    private readonly userLikeRepository: Repository<UserLike>;
    private readonly userViewRepository: Repository<UserView>;

    constructor(private readonly dataSource: DataSource) {
        this.userLikeRepository = dataSource.getRepository(UserLike);
        this.userViewRepository = dataSource.getRepository(UserView);
    }

    async ensureGameStatistics(
        manager: EntityManager,
        gameId: number,
    ): Promise<void> {
        await ensureGameStatistics(manager, gameId);
    }

    protected getTargetEntity<T extends AnyStatistics>(
        sourceType: StatisticsSourceType,
    ): EntityTarget<T> {
        return match(sourceType)
            .with(StatisticsSourceType.REVIEW, () => ReviewStatistics)
            .with(StatisticsSourceType.GAME, () => GameStatistics)
            .with(StatisticsSourceType.ACTIVITY, () => ActivityStatistics)
            .with(StatisticsSourceType.POST, () => PostStatistics)
            .with(
                P.union(
                    StatisticsSourceType.ACTIVITY_COMMENT,
                    StatisticsSourceType.REVIEW_COMMENT,
                    StatisticsSourceType.POST_COMMENT,
                ),
                () => CommentStatistics,
            )
            .exhaustive();
    }

    protected getTargetRepository<T extends AnyStatistics>(
        sourceType: StatisticsSourceType,
    ): Repository<T> {
        return this.dataSource.getRepository(this.getTargetEntity(sourceType));
    }

    protected getTargetRelationIdProperty(
        sourceType: StatisticsSourceType,
    ): string {
        return match(sourceType)
            .with(StatisticsSourceType.REVIEW, () => "reviewId")
            .with(StatisticsSourceType.GAME, () => "gameId")
            .with(StatisticsSourceType.ACTIVITY, () => "activityId")
            .with(StatisticsSourceType.POST, () => "postId")
            .with(
                StatisticsSourceType.ACTIVITY_COMMENT,
                () => "activityCommentId",
            )
            .with(StatisticsSourceType.REVIEW_COMMENT, () => "reviewCommentId")
            .with(StatisticsSourceType.POST_COMMENT, () => "postCommentId")
            .exhaustive();
    }

    /**
     * Returns the target relation on entities that inherit from {@link StatisticsAction}.
     * e.g.: UserLike and UserView
     *
     * @param sourceType
     * @protected
     */
    protected getTargetActionTableRelationProperty(
        sourceType: StatisticsSourceType,
    ) {
        return match<StatisticsSourceType, keyof (UserLike | UserView)>(
            sourceType,
        )
            .with(StatisticsSourceType.REVIEW, () => "reviewStatistics")
            .with(StatisticsSourceType.GAME, () => "gameStatistics")
            .with(StatisticsSourceType.ACTIVITY, () => "activityStatistics")
            .with(StatisticsSourceType.POST, () => "postStatistics")
            .with(
                P.union(
                    StatisticsSourceType.ACTIVITY_COMMENT,
                    StatisticsSourceType.REVIEW_COMMENT,
                    StatisticsSourceType.POST_COMMENT,
                ),
                () => "commentStatistics",
            )
            .exhaustive();
    }

    async findOne<T>(
        sourceId: string | number,
        sourceType: StatisticsSourceType,
    ): Promise<T | null> {
        const targetRelation = this.getTargetRelationIdProperty(sourceType);

        return (await this.getTargetRepository(sourceType).findOneBy({
            [targetRelation]: sourceId,
        })) as T | null;
    }

    async create<T extends AnyStatistics>(
        data: StatisticsCreateAction,
    ): Promise<T> {
        const existingEntity = await this.findOne<T>(
            data.sourceId,
            data.sourceType,
        );

        if (existingEntity) return existingEntity;

        const targetRelation = this.getTargetRelationIdProperty(
            data.sourceType,
        );

        return (await this.getTargetRepository(data.sourceType).save({
            [targetRelation]: data.sourceId,
        })) as unknown as T;
    }

    async applyReaction(
        userId: string,
        dto: ReactionRequestDto,
        isLike: boolean,
    ): Promise<ReactionResponseDto> {
        // Enforce strict property check: only sourceType and sourceId are allowed
        const allowedKeys = ["sourceType", "sourceId"];
        for (const key of Object.keys(dto)) {
            if (!allowedKeys.includes(key)) {
                throw new BadRequestException(`Unknown property: ${key}`);
            }
        }

        const { sourceType, sourceId } = dto;
        let retries = 0;
        while (true) {
            try {
                return await this.dataSource.transaction(async (manager) => {
                    let ownerUserId: string | null = null;
                    let rootType = String(sourceType);
                    let rootId = String(sourceId);
                    if (sourceType === StatisticsSourceType.GAME) {
                        const games = await manager.query(
                            "SELECT id FROM game WHERE id = ? FOR UPDATE",
                            [sourceId],
                        );
                        if (!games.length)
                            throw new NotFoundException("Game not found");
                    } else if (
                        ["post", "review", "activity"].includes(sourceType)
                    ) {
                        const source = await lockNotificationRoot(
                            manager,
                            sourceType as NotificationRootType,
                            String(sourceId),
                        );
                        if (!source)
                            throw new NotFoundException(
                                "Content not found or inaccessible",
                            );
                        ownerUserId = source.profileUserId;
                    } else if (
                        [
                            "post_comment",
                            "review_comment",
                            "activity_comment",
                        ].includes(sourceType)
                    ) {
                        rootType = sourceType.replace("_comment", "");
                        const rows = await manager.query(
                            `SELECT ${rootType}Id AS rootId FROM ${sourceType} WHERE id = ?`,
                            [sourceId],
                        );
                        if (!rows[0])
                            throw new NotFoundException("Comment not found");
                        rootId = rows[0].rootId;
                        const source = await lockNotificationComment(
                            manager,
                            rootType as NotificationRootType,
                            rootId,
                            String(sourceId),
                        );
                        if (!source)
                            throw new NotFoundException(
                                "Comment not found or inaccessible",
                            );
                        ownerUserId = source.profileUserId;
                    } else
                        throw new BadRequestException(
                            "Unsupported source type",
                        );
                    const targetEntity = this.getTargetEntity(sourceType);
                    const statsRepo = manager.getRepository(targetEntity);
                    const targetRelationIdProp =
                        this.getTargetRelationIdProperty(sourceType);

                    // Lock or initialize statistics
                    let stats: any = await statsRepo
                        .createQueryBuilder("s")
                        .setLock("pessimistic_write")
                        .where(`s.${targetRelationIdProp} = :sourceId`, {
                            sourceId,
                        })
                        .getOne();

                    if (!stats) {
                        await manager
                            .createQueryBuilder()
                            .insert()
                            .into(targetEntity)
                            .values({
                                [targetRelationIdProp]: sourceId,
                                likesCount: 0,
                                viewsCount: 0,
                            } as any)
                            .orIgnore()
                            .execute();
                        stats = await statsRepo
                            .createQueryBuilder("s")
                            .setLock("pessimistic_write")
                            .where(`s.${targetRelationIdProp} = :sourceId`, {
                                sourceId,
                            })
                            .getOne();
                    }

                    if (!stats) {
                        throw new InternalServerErrorException(
                            "Failed to load statistics",
                        );
                    }

                    const targetActionRelation =
                        this.getTargetActionTableRelationProperty(sourceType);
                    const userLikeRepo = manager.getRepository(UserLike);

                    const existingLike = await userLikeRepo
                        .createQueryBuilder("l")
                        .setLock("pessimistic_write")
                        .where("l.profileUserId = :userId", { userId })
                        .andWhere(`l.${targetActionRelation}Id = :statsId`, {
                            statsId: stats.id,
                        })
                        .getOne();

                    if (isLike) {
                        if (existingLike) {
                            return {
                                isLiked: true,
                                likesCount: Number(stats.likesCount),
                            };
                        }

                        const newLike = userLikeRepo.create({
                            profileUserId: userId,
                            [targetActionRelation]: stats,
                        });
                        const savedLike = await userLikeRepo.save(newLike);

                        const nextLikesCount = Number(stats.likesCount) + 1;
                        stats.likesCount = nextLikesCount;
                        await statsRepo.save(stats);

                        let eventSubjectType:
                            | "review"
                            | "post"
                            | "activity"
                            | "comment"
                            | "game";
                        if (sourceType === StatisticsSourceType.REVIEW)
                            eventSubjectType = "review";
                        else if (sourceType === StatisticsSourceType.POST)
                            eventSubjectType = "post";
                        else if (sourceType === StatisticsSourceType.ACTIVITY)
                            eventSubjectType = "activity";
                        else if (sourceType === StatisticsSourceType.GAME)
                            eventSubjectType = "game";
                        else eventSubjectType = "comment";

                        if (ownerUserId && ownerUserId !== userId) {
                            await appendNotificationIntent(manager, {
                                eventType: "content.liked",
                                eventVersion: 1,
                                occurredAt: new Date(),
                                recipientUserId: ownerUserId,
                                actorUserId: userId,
                                payload: {
                                    likeId: savedLike.id,
                                    subjectType: eventSubjectType,
                                    subjectId: String(sourceId),
                                    rootType,
                                    rootId,
                                },
                            });
                        }

                        return {
                            isLiked: true,
                            likesCount: nextLikesCount,
                        };
                    } else {
                        if (!existingLike) {
                            return {
                                isLiked: false,
                                likesCount: Number(stats.likesCount),
                            };
                        }

                        await userLikeRepo.delete({ id: existingLike.id });
                        const nextLikesCount = Math.max(
                            0,
                            Number(stats.likesCount) - 1,
                        );
                        stats.likesCount = nextLikesCount;
                        await statsRepo.save(stats);

                        return {
                            isLiked: false,
                            likesCount: nextLikesCount,
                        };
                    }
                });
            } catch (err: any) {
                if (
                    (err?.code === "ER_LOCK_DEADLOCK" ||
                        err?.message?.includes("Deadlock")) &&
                    retries < 3
                ) {
                    retries++;
                    await new Promise((resolve) =>
                        setTimeout(resolve, 20 * retries),
                    );
                    continue;
                }
                throw err;
            }
        }
    }

    async handleView(data: StatisticsViewAction) {
        const { userId, sourceId, sourceType } = data;
        let idToUse: number;
        if (typeof sourceId !== "number") {
            idToUse = parseInt(sourceId, 10);
        } else {
            idToUse = sourceId;
        }

        const entry = await this.create({
            sourceId: idToUse,
            sourceType: sourceType,
        });

        const targetRepository = this.getTargetRepository(sourceType);

        const targetActionRelation =
            this.getTargetActionTableRelationProperty(sourceType);

        await this.userViewRepository.save({
            profile: {
                userId: userId,
            },
            [targetActionRelation]: entry,
        });

        await targetRepository.increment(
            {
                id: entry.id,
            },
            "viewsCount",
            1,
        );
    }

    async getStatus(
        statisticsId: number,
        sourceType: StatisticsSourceType,
        userId?: string,
    ): Promise<StatisticsStatus> {
        const targetActionRelation =
            this.getTargetActionTableRelationProperty(sourceType);

        if (userId) {
            const isLikedQuery = this.userLikeRepository.exists({
                where: {
                    [targetActionRelation]: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const isViewedQuery = this.userViewRepository.exists({
                where: {
                    [targetActionRelation]: {
                        id: statisticsId,
                    },
                    profile: {
                        userId,
                    },
                },
            });
            const [isLiked, isViewed] = await Promise.all([
                isLikedQuery,
                isViewedQuery,
            ]);

            return {
                isLiked,
                isViewed,
            };
        }

        return {
            isLiked: false,
            isViewed: false,
        };
    }
}
