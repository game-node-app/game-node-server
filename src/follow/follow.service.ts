import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { UserFollow } from "./entity/user-follow.entity";
import { Repository } from "typeorm";
import { FollowStatusDto } from "./dto/follow-status.dto";

@Injectable()
export class FollowService {
    private readonly logger = new Logger(FollowService.name);

    constructor(
        @InjectRepository(UserFollow)
        private userFollowRepository: Repository<UserFollow>,
    ) {}

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
            await this.userFollowRepository.save({
                follower: {
                    userId: followerUserId,
                },
                followed: {
                    userId: followedUserId,
                },
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

        const exist = await this.userFollowRepository.exist({
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

    public async getFollowersCount(userId: string) {
        return await this.userFollowRepository.countBy({
            followed: {
                userId,
            },
        });
    }
}
