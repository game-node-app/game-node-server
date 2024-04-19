import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserFollow } from "./entity/user-follow.entity";
import { FindOptionsWhere, Repository } from "typeorm";
import { FollowStatusDto } from "./dto/follow-status.dto";
import { NotificationsQueueService } from "../notifications/notifications-queue.service";
import {
    ENotificationCategory,
    ENotificationSourceType,
} from "../notifications/notifications.constants";
import { FollowInfoRequestDto } from "./dto/follow-info-request.dto";
import { buildBaseFindOptions } from "../utils/buildBaseFindOptions";
import { TPaginationData } from "../utils/pagination/pagination-response.dto";
import { ActivitiesQueueService } from "../activities/activities-queue/activities-queue.service";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";

@Injectable()
export class FollowService {
    private readonly logger = new Logger(FollowService.name);

    constructor(
        @InjectRepository(UserFollow)
        private userFollowRepository: Repository<UserFollow>,
        private readonly notificationsQueue: NotificationsQueueService,
        private readonly activitiesQueueService: ActivitiesQueueService,
    ) {}

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
        try {
            const persistedEntry = await this.userFollowRepository.save({
                follower: {
                    userId: followerUserId,
                },
                followed: {
                    userId: followedUserId,
                },
            });

            this.notificationsQueue.registerNotification({
                userId: followerUserId,
                targetUserId: followedUserId,
                category: ENotificationCategory.FOLLOW,
                sourceType: ENotificationSourceType.PROFILE,
                sourceId: followerUserId,
            });

            this.activitiesQueueService.register({
                type: ActivityType.FOLLOW,
                sourceId: persistedEntry.id,
                profileUserId: followerUserId,
            });
        } catch (e) {
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
    public async getFollowerData(
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
        } catch (e) {
            console.error(e);
            throw new HttpException(
                "Error while removing follow",
                HttpStatus.INTERNAL_SERVER_ERROR,
            );
        }
    }
}
