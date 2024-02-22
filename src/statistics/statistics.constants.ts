export enum StatisticsSourceType {
    GAME = "game",
    REVIEW = "review",
    // ACTIVITY = "activity",
    // COLLECTION = "collection",
}

export enum StatisticsActionType {
    INCREMENT = "increment",
    DECREMENT = "decrement",
}

export enum StatisticsPeriod {
    DAY = "day",
    WEEK = "week",
    MONTH = "month",
}

/**
 * Look-up table between StatisticsPeriod and minus days (days to be subtracted from today)
 */
export const StatisticsPeriodToMinusDays = {
    [StatisticsPeriod.DAY]: 1,
    [StatisticsPeriod.WEEK]: 7,
    [StatisticsPeriod.MONTH]: 30,
};
