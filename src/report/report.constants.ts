export enum ReportSourceType {
    REVIEW = "review",
    PROFILE = "profile",
    POST = "post",
    REVIEW_COMMENT = "review_comment",
    ACTIVITY_COMMENT = "activity_comment",
    POST_COMMENT = "post_comment"
}

export enum ReportCategory {
    /**
     * Any type of spam
     */
    Spam = "spam",
    /**
     * Personal attacks, including but not limited to racism, sexism, etc.
     */
    Personal = "personal",
    Nudity = "nudity",
}

export enum ReportHandleAction {
    /**
     * Discard report
     */
    DISCARD = "discard",
    /**
     * Alert user
     */
    ALERT = "alert",
    /**
     * Suspend user for 14 days
     */
    SUSPEND = "suspend",
    /**
     * Ban user permanently
     */
    BAN = "ban",
}
