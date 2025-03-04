import { StatisticsSourceType } from "../statistics/statistics.constants";

export enum CommentSourceType {
    REVIEW = "review",
    ACTIVITY = "activity",
    POST = "post",
}

export const CommentSourceToStatisticsSource = {
    [CommentSourceType.ACTIVITY]: StatisticsSourceType.ACTIVITY_COMMENT,
    [CommentSourceType.REVIEW]: StatisticsSourceType.REVIEW_COMMENT,
    [CommentSourceType.POST]: StatisticsSourceType.POST_COMMENT,
};
