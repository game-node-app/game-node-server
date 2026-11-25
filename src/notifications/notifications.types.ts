export type NotificationFilter = "all" | "unread";

export type NotificationEventType =
    | "content.liked"
    | "comment.created"
    | "comment.replied"
    | "profile.followed"
    | "import.discovery-completed"
    | "connection.reauth-required"
    | "moderation.applied"
    | "achievement.unlocked"
    | "awards.milestone"
    | "recap.milestone"
    | "goal.reminder"
    | "guild.contract-ready"
    | "guild.contract-expiring"
    | "guild.community-bounty-ready";

export const SUPPORTED_EVENT_TYPES: readonly NotificationEventType[] = [
    "content.liked",
    "comment.created",
    "comment.replied",
    "profile.followed",
    "import.discovery-completed",
    "connection.reauth-required",
    "moderation.applied",
    "achievement.unlocked",
    "awards.milestone",
    "recap.milestone",
    "goal.reminder",
    "guild.contract-ready",
    "guild.contract-expiring",
    "guild.community-bounty-ready",
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

export interface ConnectionReauthRequiredPayload {
    connectionId: number;
    provider: string;
}

export interface AchievementUnlockedPayload {
    obtainedAchievementId: number;
    achievementId: string;
    tier: number;
}

export const AWARDS_MILESTONES = [
    "nominations_open",
    "nominations_close_reminder",
    "voting_open",
    "voting_close_reminder",
    "results_published",
] as const;

export type AwardsMilestone = (typeof AWARDS_MILESTONES)[number];

export type NotificationAwardsPhase = "nominations" | "voting" | "results";

export interface AwardsMilestonePayload {
    eventId: number;
    year: number;
    milestone: AwardsMilestone;
}

export interface RecapMilestonePayload {
    year: number;
    milestone: "available" | "closed";
}

export interface GoalReminderPayload {
    year: number;
    target: number;
    finished: number;
}

export interface GuildContractReadyPayload {
    contractId: string;
    category: string;
    templateKey: string | null;
    eventId: string | null;
    targetGameId: number | null;
}

export interface GuildContractExpiringPayload {
    contractId: string;
    category: string;
    templateKey: string | null;
    eventId: string | null;
    targetGameId: number | null;
    expiresAt: string;
}

export interface GuildCommunityBountyReadyPayload {
    bountyId: string;
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
          "connection.reauth-required",
          ConnectionReauthRequiredPayload
      >
    | BaseNotificationEventIntent<
          "moderation.applied",
          ModerationAppliedPayload
      >
    | BaseNotificationEventIntent<
          "achievement.unlocked",
          AchievementUnlockedPayload
      >
    | BaseNotificationEventIntent<"awards.milestone", AwardsMilestonePayload>
    | BaseNotificationEventIntent<"recap.milestone", RecapMilestonePayload>
    | BaseNotificationEventIntent<"goal.reminder", GoalReminderPayload>
    | BaseNotificationEventIntent<
          "guild.contract-ready",
          GuildContractReadyPayload
      >
    | BaseNotificationEventIntent<
          "guild.contract-expiring",
          GuildContractExpiringPayload
      >
    | BaseNotificationEventIntent<
          "guild.community-bounty-ready",
          GuildCommunityBountyReadyPayload
      >;

export interface NotificationGameContext {
    id: number;
    name: string;
    slug: string | null;
    coverUrl: string | null;
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
    | { type: "connection"; id: string; provider: string }
    | { type: "achievement"; id: string; tier: number }
    | {
          type: "awards";
          eventId: number;
          year: number;
          phase: NotificationAwardsPhase;
      }
    | { type: "recap"; userId: string; year: number }
    | { type: "goal"; year: number }
    | { type: "guild"; contractId: string }
    | { type: "guild"; bountyId: string };
