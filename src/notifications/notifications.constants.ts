/**
 * The action a notification represents (e.g. a new like, a new comment)
 */
export enum ENotificationCategory {
    FOLLOW = "follow",
    LIKE = "like",
    COMMENT = "comment",
    // Used by watch services like 'importer-watch'
    WATCH = "watch",
    ALERT = "alert",
}

/**
 * The source type the notification relates to.
 * @example a 'like' notification on a 'review'
 * @example a 'comment' notification on a 'review'
 * @example a 'watch' notification from the 'importer-watch' system, which generated a 'importer-watch-notification' entry.
 * @example a 'follow' notification related to a 'profile'
 * @example a 'alert' notification related to a 'report'
 */
export enum ENotificationSourceType {
    GAME = "game",
    REVIEW = "review",
    ACTIVITY = "activity",
    /**
     * Generally used for followers related notifications
     */
    PROFILE = "profile",

    IMPORTER = "importer",
    REPORT = "report",
}

export const NOTIFICATIONS_QUEUE_NAME = "notifications-queue";

export const NOTIFICATIONS_REGISTER_JOB_NAME = "notifications-register";
