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
}

const NOTIFICATIONS_QUEUE_NAME = "notifications-queue";
