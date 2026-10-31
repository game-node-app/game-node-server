import { HttpException, HttpStatus, Injectable, Logger, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserFollow } from "./entity/user-follow.entity";
import { DataSource, EntityManager, FindOptionsWhere, Repository } from "typeorm";
import { FollowStatusDto } from "./dto/follow-status.dto";
import { FollowInfoRequestDto } from "./dto/follow-info-request.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { ActivitiesQueueService } from "../activities/activities-queue/activities-queue.service";
import { PeriodRange } from "../utils/period";
import { appendNotificationIntent } from "../notifications/notifications-outbox.service";
import { AchievementsQueueService } from "../achievements/achievements-queue/achievements-queue.service";

@Injectable()
export class FollowService {
    private readonly logger = new Logger(FollowService.name);

    constructor(
        @InjectRepository(UserFollow)
        private userFollowRepository: Repository<UserFollow>,
        @Optional()
        private readonly dataSource?: DataSource,
        @Optional()
        private readonly activitiesQueueService?: ActivitiesQueueService,
        @Optional()
        private readonly achievementsQueueService?: AchievementsQueueService,
    ) {}

    public async countFollowers(
        userId: string,
        period: PeriodRange,
    ): Promise<number> {
        const qb = this.userFollowRepository
            .createQueryBuilder("uf")
            .where("uf.followedUserId = :userId", { userId });

        if (period.startDate) {
            qb.andWhere("uf.createdAt >= :startDate", {
                startDate: period.startDate,
            });
        }
        if (period.endDate) {
            qb.andWhere("uf.createdAt <= :endDate", {
                endDate: period.endDate,
            });
        }

        return qb.getCount();
    }

    public async findOneById(id: number) {
        return this.userFollowRepository.findOne({
            where: {
                id,
            },
        });
    }

    public async findOneByIdOrFail(id: number) {
        const entity = await this.findOneById(id);
        if (!entity) {
            throw new HttpException(
                "No user follow matches specified id",
                HttpStatus.NOT_FOUND,
            );
        }
        return entity;
    }

    public async registerFollow(
        followerUserId: string,
        followedUserId: string,
    ) {
        if (followerUserId === followedUserId) {
            throw new HttpException(
                "User can't follow itself.",
                HttpStatus.I_AM_A_TEAPOT,
            );
        }

        const runTransaction = async (manager?: EntityManager) => {
            const followRepo =
                manager && typeof manager.getRepository === "function"
                    ? manager.getRepository(UserFollow)
                    : this.userFollowRepository;

            if (!manager || typeof manager.createQueryBuilder !== "function") {
                const followToSave = {
                    follower: {
                        userId: followerUserId,
                    },
                    followed: {
                        userId: followedUserId,
                    },
                };
                return await followRepo.save(followToSave as any);
            }

            const insertResult: any = await manager.query(
                `INSERT IGNORE INTO user_follow (followerUserId, followedUserId, createdAt, updatedAt) VALUES (?, ?, NOW(), NOW())`,
                [followerUserId, followedUserId],
            );

            const isNew = insertResult?.affectedRows > 0;

            const follow = await followRepo.findOne({
                where: {
                    followerUserId,
                    followedUserId,
                },
            });

            if (isNew && follow) {
                await appendNotificationIntent(manager, {
                    eventType: "profile.followed",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    recipientUserId: followedUserId,
                    actorUserId: followerUserId,
                    payload: {
                        followId: follow.id,
                    },
                });
            }

            return follow;
        };

        try {
            const follow = this.dataSource?.transaction
                ? await this.dataSource.transaction(runTransaction)
                : await runTransaction(this.userFollowRepository.manager);
            this.achievementsQueueService?.addTrackingJob({
                userId: followedUserId,
                metric: "followers",
            });
            return follow;
        } catch (e: any) {
            if (e instanceof HttpException) {
                throw e;
            }
            this.logger.error(e);
            throw new HttpException(
                "Error while registering user follow",
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }

    public async getStatus(
        followerUserId: string,
        followedUserId: string,
    ): Promise<FollowStatusDto> {
        const userIdLength = 36;
        const params = [followerUserId, followedUserId] as const;
        for (const param of params) {
            if (typeof param !== "string" || param.length !== userIdLength) {
                throw new HttpException(
                    "Malformed parameters.",
                    HttpStatus.BAD_REQUEST,
                );
            }
        }

        if (followerUserId === followedUserId) {
            return {
                isFollowing: false,
            };
        }

        const exist = await this.userFollowRepository.exists({
            where: {
                follower: {
                    userId: followerUserId,
                },
                followed: {
                    userId: followedUserId,
                },
            },
        });

        return {
            isFollowing: exist,
        };
    }

    /**
     * Gets followers or followed user ids with pagination data.
     * @param dto
     */
    public async getFollowerInfo(
        dto: FollowInfoRequestDto,
    ): Promise<TPaginationData<string>> {
        const baseFindOptions = buildBaseFindOptions(dto);
        const findOptionsWhere: FindOptionsWhere<UserFollow> = {};
        if (dto.criteria === "followers") {
            findOptionsWhere.followedUserId = dto.targetUserId;
        } else {
            findOptionsWhere.followerUserId = dto.targetUserId;
        }

        const [items, count] = await this.userFollowRepository.findAndCount({
            ...baseFindOptions,
            where: findOptionsWhere,
            cache: true,
        });
        const userIds = items.map((userFollow) => {
            if (dto.criteria === "followers") {
                return userFollow.followerUserId;
            }
            return userFollow.followedUserId;
        });

        return [userIds, count];
    }

    async removeFollow(followerUserId: string, followedUserId: string) {
        if (followerUserId === followedUserId) {
            throw new HttpException(
                "User can't unfollow itself",
                HttpStatus.I_AM_A_TEAPOT,
            );
        }
        try {
            await this.userFollowRepository.delete({
                follower: {
                    userId: followerUserId,
                },
                followed: {
                    userId: followedUserId,
                },
            });
            // Keeps the shown progress current; obtained tiers are never revoked
            this.achievementsQueueService?.addTrackingJob({
                userId: followedUserId,
                metric: "followers",
            });
        } catch (e) {
            console.error(e);
            throw new HttpException(
                "Error while removing follow",
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}
