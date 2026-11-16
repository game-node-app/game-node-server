import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import {
    ActivitiesFeedRequestDto,
    ActivityFeedCriteria,
} from "./dto/activities-feed-request.dto";
import { ActivitiesRepositoryService } from "../activities-repository/activities-repository.service";
import { ActivityResponseDto } from "../activities-repository/dto/activity-response.dto";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { FollowService } from "../../follow/follow.service";
import { In } from "typeorm";
import { minutes } from "@nestjs/throttler";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";

@Injectable()
export class ActivitiesFeedService {
    constructor(
        private activitiesRepositoryService: ActivitiesRepositoryService,
        private followService: FollowService,
    ) {}

    private getCacheKey(
        userId: string | undefined,
        dto: ActivitiesFeedRequestDto,
    ) {
        const userCacheKey = userId ?? "all";
        return `${userCacheKey}-${JSON.stringify(dto)}`;
    }

    private async buildGeneralActivitiesFeed(
        dto: ActivitiesFeedRequestDto,
        userId?: string,
    ): Promise<TPaginationData<ActivityResponseDto>> {
        const findOptions = buildBaseFindOptions(dto);
        const results = await this.activitiesRepositoryService.findLatestBy(
            findOptions,
            userId,
        );
        return results;
    }

    private async buildFollowingActivitiesFeed(
        userId: string,
        dto: ActivitiesFeedRequestDto,
    ): Promise<TPaginationData<ActivityResponseDto>> {
        const [followedUsersIds] = await this.followService.getFollowerInfo({
            targetUserId: userId,
            criteria: "following",
            offset: 0,
            limit: 9999999,
        });

        const baseFindOptions = buildBaseFindOptions(dto);

        return await this.activitiesRepositoryService.findLatestBy(
            {
                ...baseFindOptions,
                where: {
                    profileUserId: In(followedUsersIds),
                },
                cache: {
                    id: this.getCacheKey(userId, dto),
                    milliseconds: minutes(5),
                },
            },
            userId,
        );
    }

    async buildActivitiesFeed(
        userId: string | undefined,
        dto: ActivitiesFeedRequestDto,
    ): Promise<TPaginationData<ActivityResponseDto>> {
        switch (dto.criteria) {
            case ActivityFeedCriteria.FOLLOWING:
                if (userId == undefined) {
                    throw new HttpException(
                        "User must be logged-in to see following user activities.",
                        HttpStatus.BAD_REQUEST,
                    );
                }
                return this.buildFollowingActivitiesFeed(userId, dto);
            case ActivityFeedCriteria.ALL:
                return this.buildGeneralActivitiesFeed(dto, userId);
            default:
                throw new HttpException(
                    "Activity Feed criteria not supported.",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }
}
