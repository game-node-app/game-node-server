export enum ReportSourceType {
    REVIEW = "review",
    PROFILE = "profile",
    REVIEW_COMMENT = "review_comment",
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
