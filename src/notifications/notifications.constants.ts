/**
 * The action a notification represents (e.g. a new like, a new comment)
 */
export enum ENotificationCategory {
    FOLLOW = "follow",
    LIKE = "like",
    COMMENT = "comment",
    LAUNCH = "launch",
}

export enum ENotificationSourceType {
    GAME = "game",
    REVIEW = "review",
    ACTIVITY = "activity",
    /**
     * Generally used for followers related notifications
     */
    PROFILE = "profile",
}

export const NOTIFICATIONS_QUEUE_NAME = "notifications-queue";

export const NOTIFICATIONS_REGISTER_JOB_NAME = "notifications-register";
