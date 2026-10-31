export type NotificationEventType =
    | "content.liked"
    | "comment.created"
    | "comment.replied"
    | "profile.followed"
    | "import.discovery-completed"
    | "moderation.applied"
    | "achievement.unlocked";

export const SUPPORTED_EVENT_TYPES: readonly NotificationEventType[] = [
    "content.liked",
    "comment.created",
    "comment.replied",
    "profile.followed",
    "import.discovery-completed",
    "moderation.applied",
    "achievement.unlocked",
] as const;

export const SUPPORTED_EVENT_VERSION = 1;
export const MAX_PAYLOAD_BYTES = 65536; // 64 KB

export interface BaseNotificationEventIntent<
    TType extends NotificationEventType,
    TPayload,
> {
    id?: string;
    eventType: TType;
    eventVersion: number;
    occurredAt?: Date;
    recipientUserId: string | null;
    actorUserId: string | null;
    payload: TPayload;
}

export interface ContentLikedPayload {
    likeId: number;
    subjectType: "review" | "post" | "activity" | "comment" | "game";
    subjectId: string;
    rootType?: string;
    rootId?: string;
}

export interface CommentCreatedPayload {
    commentId: string;
    rootType: "review" | "post" | "activity";
    rootId: string;
}

export interface CommentRepliedPayload {
    commentId: string;
    parentCommentId: string;
    rootType: "review" | "post" | "activity";
    rootId: string;
}

export interface ProfileFollowedPayload {
    followId: number;
}

export interface ImportDiscoveryCompletedPayload {
    discoveryResultId: number | string;
    provider: string;
    gameCount: number;
    importedCount: number;
    skippedCount: number;
    failedCount: number;
    gameSample?: Array<{ id: number; title: string }>;
}

export interface ModerationAppliedPayload {
    action: "alert" | "suspension" | "ban";
    safeReason?: string;
    reportId?: number;
}

export interface AchievementUnlockedPayload {
    obtainedAchievementId: number;
    achievementId: string;
    tier: number;
}

export type NotificationEventIntent =
    | BaseNotificationEventIntent<"content.liked", ContentLikedPayload>
    | BaseNotificationEventIntent<"comment.created", CommentCreatedPayload>
    | BaseNotificationEventIntent<"comment.replied", CommentRepliedPayload>
    | BaseNotificationEventIntent<"profile.followed", ProfileFollowedPayload>
    | BaseNotificationEventIntent<
          "import.discovery-completed",
          ImportDiscoveryCompletedPayload
      >
    | BaseNotificationEventIntent<
          "moderation.applied",
          ModerationAppliedPayload
      >
    | BaseNotificationEventIntent<
          "achievement.unlocked",
          AchievementUnlockedPayload
      >;

export interface NotificationGameContext {
    id: number;
    name: string;
    slug: string | null;
}

export interface NotificationActivityContent {
    type:
        | "post"
        | "review"
        | "collection_entry"
        | "collection"
        | "follow"
        | "achievement"
        | "platform_achievement";
    id: string;
}

export type NotificationTarget =
    | { type: "post" | "review"; id: string; focusId?: string }
    | {
          type: "activity";
          id: string;
          focusId?: string;
          activityType: string;
          content?: NotificationActivityContent;
          game?: NotificationGameContext;
      }
    | { type: "profile"; id: string }
    | { type: "importer"; id: string; provider: string }
    | { type: "achievement"; id: string; tier: number };
