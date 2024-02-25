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
    QUARTER = "quarter",
    HALF_YEAR = "half_year",
    YEAR = "year",
}

/**
 * Look-up table between StatisticsPeriod and minus days (days to be subtracted from today)
 */
export const StatisticsPeriodToMinusDays = {
    [StatisticsPeriod.DAY]: 1,
    [StatisticsPeriod.WEEK]: 7,
    [StatisticsPeriod.MONTH]: 30,
    [StatisticsPeriod.QUARTER]: 90,
    [StatisticsPeriod.HALF_YEAR]: 180,
    [StatisticsPeriod.YEAR]: 365,
};
