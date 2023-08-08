export type TStatisticsCounterAction = "increment" | "decrement";

export type TStatisticsGameLikeData = {
    igdbId: number;
    userId: string;
};

export type TStatisticsGameViewData = {
    igdbId: number;
    userId?: string;
};

export type TStatisticsReviewLikeData = {
    reviewId: number;
    userId: string;
};
