import { Inject, Injectable } from "@nestjs/common";
import { CollectionsEntriesService } from "src/collections/collections-entries/collections-entries.service";
import { ReviewsService } from "src/reviews/reviews.service";
import { ActivityType } from "../activities-queue/activities-queue.constants";
import { ProfileService } from "src/profile/profile.service";
import { Activity } from "../activities-repository/entities/activity.entity";
import { BuildActivitiesDto } from "./dto/build-activities.dto";
import { ActivitiesRepositoryService } from "../activities-repository/activities-repository.service";
import { ActivitiesFeedEntryDto } from "./dto/activities-feed-entry.dto";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import { Cache } from "cache-manager";
import { Review } from "../../reviews/entities/review.entity";
import { CollectionEntry } from "../../collections/collections-entries/entities/collection-entry.entity";

@Injectable()
export class ActivitiesFeedService {
    private readonly activitiesFeedCacheKey = "activities-feed";

    /**
     * Chances of a given activity being selected by the builder, in the form of a percentage.
     * Make sure this amounts to 1 (100%).
     */
    private readonly activitiesFeedChances = {
        [ActivityType.COLLECTION_ENTRY]: 0.25,
        // This is not implemented yet.
        [ActivityType.FOLLOW]: 0.0,
        [ActivityType.REVIEW]: 0.75,
    };

    constructor(
        @Inject(CACHE_MANAGER) private cacheManager: Cache,
        private activitiesRepositoryService: ActivitiesRepositoryService,
        private profileService: ProfileService,
        private reviewsService: ReviewsService,
        private collectionEntriesService: CollectionsEntriesService,
    ) {
        const sumOfChances = Object.values(this.activitiesFeedChances).reduce(
            (a, b) => a + b,
            0,
        );
        if (sumOfChances !== 1) {
            throw new Error(
                "The sum of all chances in ActivitiesFeedService#activitiesFeedChances must be equal to 1.",
            );
        }
    }

    /**
     * Generates a random activity type based on weighted chances.
     * TODO: Make this more aligned with the user's preferences.
     * @private
     * @throws {Error} - If the random activity type cannot be determined.
     */
    private getWeightedRandomActivityType() {
        const sum = Object.values(this.activitiesFeedChances).reduce(
            (a, b) => a + b,
            0,
        );
        const random = Math.random();
        let cumulative = 0;
        for (const [activityType, chance] of Object.entries(
            this.activitiesFeedChances,
        )) {
            cumulative += chance / sum;
            if (random < cumulative) {
                return ActivityType[activityType as keyof typeof ActivityType];
            }
        }

        throw new Error("This should never happen.");
    }

    /**
     * Resolves the sources of the activities.
     * This is probably very expensive. You are free to open an PR suggesting a better way to do this.
     * Do keep in mind that fetchi-lng sources shouldn't ever be handled by the client (e.g. the frontend).
     * The logic here is that we make a single SELECT query per activity type, and then use native JS functions to populate the correct source.
     * @param activities
     */
    async resolveActivitiesSources(
        activities: Activity[],
    ): Promise<ActivitiesFeedEntryDto[]> {
        const activitiesFeedEntries: ActivitiesFeedEntryDto[] = [];
        const reviewsIds = activities
            .filter((activity) => activity.type === ActivityType.REVIEW)
            .map((activity) => activity.sourceId);
        const collectionEntriesIds = activities
            .filter(
                (activity) => activity.type === ActivityType.COLLECTION_ENTRY,
            )
            .map((activity) => activity.sourceId);

        const reviewsPromise = this.reviewsService.findAllByIdIn(reviewsIds);
        const collectionEntriesPromise =
            this.collectionEntriesService.findAllByIdIn(collectionEntriesIds);

        const [reviews, collectionEntries] = await Promise.all([
            reviewsPromise,
            collectionEntriesPromise,
        ]);

        // Convert to maps for faster access.
        const reviewsMap = new Map<string, Review>(
            reviews.map((review) => [review.id, review]),
        );

        const collectionEntriesMap = new Map<string, CollectionEntry>(
            collectionEntries.map((collectionEntry) => [
                collectionEntry.id,
                collectionEntry,
            ]),
        );

        for (const activity of activities) {
            let source;
            switch (activity.type) {
                case ActivityType.REVIEW:
                    source = reviewsMap.get(activity.sourceId);
                    break;
                case ActivityType.COLLECTION_ENTRY:
                    source = collectionEntriesMap.get(activity.sourceId);
                    break;
            }

            if (source) {
                activitiesFeedEntries.push({ ...activity, source });
            }
        }

        return activitiesFeedEntries;
    }

    async buildLatestActivitiesFeed() {
        const latestActivities =
            await this.activitiesRepositoryService.findLatest(120);

        const latestActivitiesFeedEntries =
            await this.resolveActivitiesSources(latestActivities);

        const activitiesFeed: ActivitiesFeedEntryDto[] = [];
        const exhaustedActivitiesTypes: ActivityType[] = [];
        while (latestActivitiesFeedEntries.length !== 0) {
            const nextActivityType = this.getWeightedRandomActivityType();
            if (exhaustedActivitiesTypes.includes(nextActivityType)) {
                // If we already exausted this activity type, we skip it.
                continue;
            }

            const nextActivityIndex = latestActivitiesFeedEntries.findIndex(
                (activity) => activity.type === nextActivityType,
            );
            if (nextActivityIndex === -1) {
                // If there are no more activities of this type, we mark it as exausted and continue.
                exhaustedActivitiesTypes.push(nextActivityType);
                continue;
            }

            activitiesFeed.push(latestActivitiesFeedEntries[nextActivityIndex]);
            // Removes the activity from the array so it doesn't get selected again.
            latestActivitiesFeedEntries.splice(nextActivityIndex, 1);
        }

        return activitiesFeed;
    }

    async buildActivitiesFeed(
        userId: string,
        buildActivitiesDto: BuildActivitiesDto,
    ) {
        switch (buildActivitiesDto.criteria) {
        }
    }
}
