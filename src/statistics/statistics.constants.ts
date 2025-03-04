export enum StatisticsSourceType {
    GAME = "game",
    REVIEW = "review",
    ACTIVITY = "activity",
    POST = "post",
    REVIEW_COMMENT = "review_comment",
    ACTIVITY_COMMENT = "activity_comment",
    POST_COMMENT = "post_comment",
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
    ALL = "all",
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
    [StatisticsPeriod.ALL]: 365 * 100,
};
