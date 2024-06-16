export enum ReportSourceType {
    REVIEW = "review",
    PROFILE = "profile",
}

export enum ReportCategory {
    Spam = "spam",
}

export enum ReportHandleAction {
    /**
     * Discard report
     */
    DISCARD = "discard",
    ALERT = "alert",
    SUSPEND = "suspend",
    BAN = "ban",
}
