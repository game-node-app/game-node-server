export const BASE_LEVEL_UP_COST = 100;

/**
 * Activities that automatically grant some EXP when performed.
 * It's important to make sure these activities won't make it simple
 * for users to exploit the leveling process.
 */
export enum LevelIncreaseActivities {
    REVIEW_CREATED = "review_created",
    COLLECTION_ENTRY_CREATED = "collection_entry_created",
}

export const LevelActivitiesToIncreaseAmountMap = {
    [LevelIncreaseActivities.REVIEW_CREATED]: 50,
    [LevelIncreaseActivities.COLLECTION_ENTRY_CREATED]: 15,
};
