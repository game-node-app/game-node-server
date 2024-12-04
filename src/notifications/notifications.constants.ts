/**
 * The action a notification represents (e.g. a new like, a new comment)
 */
export enum ENotificationCategory {
    FOLLOW = "follow",
    LIKE = "like",
    COMMENT = "comment",
    // Used by watch services like 'importer-watch'
    WATCH = "watch",
    // Used by the suspension module
    ALERT = "alert",
    MENTION = "mention",
}

/**
 * The source type the notification relates to.
 * This one can and should be pretty diverse, to easily represent a target entity.
 * @example a 'like' notification on a 'review'
 * @example a 'comment' notification on a 'review'
 * @example a 'watch' notification from the 'importer-watch' system, which generated a 'importer-watch-notification' entry.
 * @example a 'follow' notification related to a 'profile'
 * @example a 'alert' notification related to a 'report'
 */
export enum ENotificationSourceType {
    GAME = "game",
    REVIEW = "review",
    // Used with 'comment' category to indicate it's a notification related to a review comment (not the review itself)
    REVIEW_COMMENT = "review_comment",
    ACTIVITY = "activity",
    // Used with 'comment' category to indicate it's a notification related to a activity comment (not the activity itself)
    // e.g. deep nested activity comment
    ACTIVITY_COMMENT = "activity_comment",
    /**
     * Generally used for followers related notifications
     */
    PROFILE = "profile",

    IMPORTER = "importer",
    REPORT = "report",
}

export const NOTIFICATIONS_QUEUE_NAME = "notifications-queue";

export const NOTIFICATIONS_REGISTER_JOB_NAME = "notifications-register";
