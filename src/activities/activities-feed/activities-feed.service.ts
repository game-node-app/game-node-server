import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { Activity } from "../activities-repository/entities/activity.entity";
import { ActivitiesFeedRequestDto } from "./dto/activities-feed-request.dto";
import { ActivitiesRepositoryService } from "../activities-repository/activities-repository.service";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { TPaginationData } from "../../utils/pagination/pagination-response.dto";
import { ActivityType } from "../activities-queue/activities-queue.constants";

export const ACTIVITY_FEED_CACHE_KEY = "queue-feed";

@Injectable()
export class ActivitiesFeedService {
    /**
     * Chances of a given activity being selected by the builder, in the form of a percentage.
     * Make sure this amounts to 1 (100%).
     */
    private readonly activitiesTypeChances = {
        [ActivityType.COLLECTION_ENTRY]: 0.3,
        // This is not implemented yet.
        [ActivityType.FOLLOW]: 0.0,
        [ActivityType.REVIEW]: 0.7,
    };

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private activitiesRepositoryService: ActivitiesRepositoryService,
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

    async buildActivitiesFeed(
        userId: string | undefined,
        dto: ActivitiesFeedRequestDto,
    ): Promise<TPaginationData<Activity>> {
        const offset = dto.offset || 0;
        const limit = dto.limit || 20;
        switch (dto.criteria) {
            default:
                throw new HttpException(
                    "Activity Feed criteria not supported.",
                    HttpStatus.BAD_REQUEST,
                );
        }
    }
}
