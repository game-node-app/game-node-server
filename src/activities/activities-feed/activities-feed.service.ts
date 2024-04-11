import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Activity } from "../activities-repository/entities/activity.entity";
import {
    ActivitiesFeedRequestDto,
    ActivityFeedCriteria,
} from "./dto/activities-feed-request.dto";
import { ActivitiesRepositoryService } from "../activities-repository/activities-repository.service";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { FollowService } from "../../follow/follow.service";
import { In } from "typeorm";
import { minutes } from "@nestjs/throttler";
import { buildBaseFindOptions } from "../../utils/buildBaseFindOptions";

export const ACTIVITY_FEED_CACHE_KEY = "queue-feed";

@Injectable()
export class ActivitiesFeedService {
    /**
     * Chances of a given activity being selected by the builder, in the form of a percentage.
     * Make sure this amounts to 1 (100%).
     */
    private readonly activitiesTypeChances = {
        [ActivityType.COLLECTION_ENTRY]: 0.2,
        [ActivityType.FOLLOW]: 0.2,
        [ActivityType.REVIEW]: 0.6,
    };

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private activitiesRepositoryService: ActivitiesRepositoryService,
        private followService: FollowService,
    ) {
        const sumOfTypeChances = Object.values(
            this.activitiesTypeChances,
        ).reduce((a, b) => a + b, 0);
        if (sumOfTypeChances !== 1) {
            throw new Error(
                "The sum of all values in activitiesFeedChances and activitiesCriteriaChances must be equal to 1.",
            );
        }
    }

    /**
     * Generates a random activity type based on weighted chances.
     * TODO: Check if this is actually useful
     * @private
     * @throws {Error} - If the random activity type cannot be determined.
     */
    private getWeightedRandomActivityType() {
        const sum = Object.values(this.activitiesTypeChances).reduce(
            (a, b) => a + b,
            0,
        );
        const random = Math.random();
        let cumulative = 0;
        for (const [activityType, chance] of Object.entries(
            this.activitiesTypeChances,
        )) {
            cumulative += chance / sum;
            if (random < cumulative) {
                return ActivityType[activityType as keyof typeof ActivityType];
            }
        }

        throw new Error("This should never happen.");
    }

    private getCacheKey(
        userId: string | undefined,
        dto: ActivitiesFeedRequestDto,
    ) {
        const userCacheKey = userId ?? "all";
        return `${userCacheKey}-${JSON.stringify(dto)}`;
    }

    private async buildGeneralActivitiesFeed(dto: ActivitiesFeedRequestDto) {
        const findOptions = buildBaseFindOptions(dto);
        return await this.activitiesRepositoryService.findLatestBy(findOptions);
    }

    private async buildFollowingActivitiesFeed(
        userId: string,
        dto: ActivitiesFeedRequestDto,
    ): Promise<TPaginationData<Activity>> {
        const [followedUsersIds] = await this.followService.getFollowerData({
            targetUserId: userId,
            criteria: "followers",
            offset: 0,
            limit: 9999999,
        });

        const baseFindOptions = buildBaseFindOptions(dto);

        return await this.activitiesRepositoryService.findLatestBy({
            ...baseFindOptions,
            where: {
                profileUserId: In(followedUsersIds),
            },
            cache: {
                id: this.getCacheKey(userId, dto),
                milliseconds: minutes(5),
            },
        });
    }

    async buildActivitiesFeed(
        userId: string | undefined,
        dto: ActivitiesFeedRequestDto,
    ): Promise<TPaginationData<Activity>> {
        switch (dto.criteria) {
            case ActivityFeedCriteria.FOLLOWING:
                if (userId == undefined) {
                    throw new HttpException(
                        "User must be logged-in to see following activities.",
                        HttpStatus.UNAUTHORIZED,
                    );
                }
                return this.buildFollowingActivitiesFeed(userId, dto);
            case ActivityFeedCriteria.ALL:
                return this.buildGeneralActivitiesFeed(dto);
            default:
                throw new HttpException(
                    "Activity Feed criteria not supported.",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }
}
