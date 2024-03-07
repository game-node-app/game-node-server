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
    PROFILE = "profile",
}

export const NOTIFICATIONS_QUEUE_NAME = "notifications-queue";

export const NOTIFICATIONS_REGISTER_JOB_NAME = "notifications-register-job";
