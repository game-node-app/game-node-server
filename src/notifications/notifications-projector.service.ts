import { Injectable, Logger } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationsRelayService } from "./notifications-relay.service";
import {
    lockNotificationRoot,
    lockNotificationComment,
    NotificationRootType,
} from "./notifications-lifecycle.service";
import { NotificationEventIntent } from "./notifications.types";
import {
    NotificationIntentValidationError,
    validateNotificationIntent,
} from "./notifications-outbox.service";

// shortcut: generic summary for HTML-only content without an external parser dependency, upgrade when a trusted parser is added
export function extractSafePlainText(
    content: string | null | undefined,
    fallbackSummary = "Shared content",
): string {
    if (
        !content ||
        typeof content !== "string" ||
        content.trim().length === 0
    ) {
        return fallbackSummary;
    }
    // Check for HTML tags:
    if (/<[a-z/][\s\S]*>/i.test(content)) {
        return fallbackSummary;
    }
    return content.trim().slice(0, 240);
}

export interface ResolvedEventDetails {
    recipientUserId: string;
    actorUserId: string | null;
    subjectType: string | null;
    subjectId: string | null;
    rootType: string | null;
    rootId: string | null;
    preview: Record<string, any> | null;
    target: Record<string, any> | null;
    isSuppressed?: boolean;
    suppressionReason?: string;
}

export async function materializeNotificationTarget(
    manager: EntityManager,
    type: NotificationRootType,
    id: string,
    root: any,
    focusId?: string,
) {
    const target: Record<string, any> = { type, id };
    if (focusId) target.focusId = focusId;
    if (type === "activity") {
        target.activityType = root.type;
        for (const [field, contentType] of [
            ["postId", "post"],
            ["reviewId", "review"],
            ["collectionEntryId", "collection_entry"],
            ["collectionId", "collection"],
            ["userFollowId", "follow"],
            ["obtainedGameAchievementActivityId", "achievement"],
        ]) {
            if (root[field]) {
                target.content = {
                    type: contentType,
                    id: String(root[field]),
                };
                break;
            }
        }
        let gameId = root.gameId;
        if (!gameId && root.obtainedGameAchievementActivityId) {
            const rows = await manager.query(
                `SELECT e.gameId FROM obtained_game_achievement_activity a
                JOIN game_external_game e ON e.id = a.externalGameId WHERE a.id = ?`,
                [root.obtainedGameAchievementActivityId],
            );
            gameId = rows[0]?.gameId;
        }
        if (gameId) {
            const games = await manager.query(
                "SELECT id, name, slug FROM game WHERE id = ?",
                [gameId],
            );
            if (games[0])
                target.game = {
                    id: Number(games[0].id),
                    name: extractSafePlainText(games[0].name, "Game"),
                    slug: games[0].slug,
                };
        }
    }
    return target;
}

@Injectable()
export class NotificationsProjectorService {
    private readonly logger = new Logger(NotificationsProjectorService.name);

    constructor(
        private readonly dataSource: DataSource,
        private readonly relayService: NotificationsRelayService,
    ) {}

    async projectEvent(
        eventId: string,
        attemptToken: string,
    ): Promise<boolean> {
        if (
            typeof eventId !== "string" ||
            !eventId.trim() ||
            eventId.length > 255 ||
            typeof attemptToken !== "string" ||
            !attemptToken.trim() ||
            attemptToken.length > 255
        )
            return false;
        try {
            return await this.dataSource.transaction(async (manager) => {
                const outbox = await manager.findOne(NotificationOutbox, {
                    where: {
                        id: eventId,
                        ownerToken: attemptToken,
                        state: "processing",
                    },
                    lock: { mode: "pessimistic_write" },
                });

                if (!outbox) {
                    this.logger.warn("Ignoring a stale notification worker");
                    return false;
                }

                if (
                    outbox.ownerExpiresAt &&
                    outbox.ownerExpiresAt.getTime() <= Date.now()
                ) {
                    this.logger.warn("Ignoring an expired notification worker");
                    return false;
                }

                validateNotificationIntent(
                    outbox as unknown as NotificationEventIntent,
                );

                // Resolve event details based on eventType
                const resolved = await this.resolveEventDetails(
                    manager,
                    outbox,
                );

                if (resolved.isSuppressed) {
                    await this.completeOwnedOutbox(
                        manager,
                        eventId,
                        attemptToken,
                        "suppressed",
                        resolved.suppressionReason,
                    );
                    return true;
                }

                const {
                    recipientUserId,
                    actorUserId,
                    subjectType,
                    subjectId,
                    rootType,
                    rootId,
                    preview,
                    target,
                } = resolved;

                // Self-notification suppression
                if (actorUserId && actorUserId === recipientUserId) {
                    await this.completeOwnedOutbox(
                        manager,
                        eventId,
                        attemptToken,
                        "suppressed",
                        "self_notification",
                    );
                    return true;
                }

                // Calculate Group Key with UTC calendar day
                const occurredAt = outbox.occurredAt || new Date();
                const utcDate = occurredAt.toISOString().slice(0, 10);
                let groupKey: string;

                if (outbox.eventType === "content.liked") {
                    groupKey = `${recipientUserId}:content.liked:${subjectType}:${subjectId}:${utcDate}`;
                } else if (outbox.eventType === "comment.created") {
                    groupKey = `${recipientUserId}:comment.created:${rootType}:${rootId}:${utcDate}`;
                } else if (outbox.eventType === "comment.replied") {
                    groupKey = `${recipientUserId}:comment.replied:comment:${subjectId}:${utcDate}`;
                } else {
                    groupKey = `${recipientUserId}:${outbox.eventType}:${outbox.id}`;
                }

                // Check if contribution was already inserted (idempotency check)
                const existingEvent = await manager.findOne(NotificationEvent, {
                    where: { eventId: outbox.id, recipientUserId },
                });

                if (existingEvent) {
                    // Already contributed: complete outbox without changing inbox or read state
                    await this.completeOwnedOutbox(
                        manager,
                        eventId,
                        attemptToken,
                        "completed",
                    );
                    return true;
                }

                // The upsert serializes first contributions as well as updates to existing groups.
                await manager
                    .createQueryBuilder()
                    .insert()
                    .into(NotificationInbox)
                    .values({
                        recipientUserId,
                        groupKey,
                        type: outbox.eventType,
                        subjectType,
                        subjectId,
                        rootType,
                        rootId,
                        actorIds: [],
                        eventCount: 0,
                        actorCount: 0,
                        lastEventAt: occurredAt,
                        version: 0,
                        readVersion: 0,
                        isVisible: true,
                        isRedacted: false,
                    })
                    .orUpdate(["groupKey"])
                    .updateEntity(false)
                    .execute();
                const inbox = await manager.findOneOrFail(NotificationInbox, {
                    where: { recipientUserId, groupKey },
                    lock: { mode: "pessimistic_write" },
                });
                const priorActorEvents = actorUserId
                    ? await manager.query(
                          `SELECT id FROM notification_event WHERE recipientUserId = ? AND groupKey = ? AND actorUserId = ? LIMIT 1 FOR UPDATE`,
                          [recipientUserId, groupKey, actorUserId],
                      )
                    : [];
                const latestEvents = await manager.query(
                    `SELECT eventId, occurredAt FROM notification_event WHERE recipientUserId = ? AND groupKey = ? ORDER BY occurredAt DESC, eventId DESC LIMIT 1 FOR UPDATE`,
                    [recipientUserId, groupKey],
                );
                const latest = latestEvents[0];
                const isNewer =
                    !latest ||
                    occurredAt.getTime() >
                        new Date(latest.occurredAt).getTime() ||
                    (occurredAt.getTime() ===
                        new Date(latest.occurredAt).getTime() &&
                        outbox.id > latest.eventId);
                await manager.save(
                    NotificationEvent,
                    manager.create(NotificationEvent, {
                        eventId: outbox.id,
                        recipientUserId,
                        groupKey,
                        eventType: outbox.eventType,
                        actorUserId,
                        subjectType,
                        subjectId,
                        rootType,
                        rootId,
                        triggerCommentId: target?.focusId || null,
                        preview,
                        target,
                        occurredAt,
                    }),
                );
                const actors = await manager.query(
                    `SELECT actorUserId FROM notification_event WHERE recipientUserId = ? AND groupKey = ? AND actorUserId IS NOT NULL
                     GROUP BY actorUserId ORDER BY MAX(occurredAt) DESC, MAX(eventId) DESC LIMIT 3 FOR UPDATE`,
                    [recipientUserId, groupKey],
                );
                await manager.update(
                    NotificationInbox,
                    { id: inbox.id },
                    {
                        eventCount: inbox.eventCount + 1,
                        actorCount:
                            inbox.actorCount +
                            (actorUserId && priorActorEvents.length === 0
                                ? 1
                                : 0),
                        actorIds: actors.map(
                            (row: { actorUserId: string }) => row.actorUserId,
                        ),
                        version: inbox.version + 1,
                        lastEventAt: isNewer ? occurredAt : inbox.lastEventAt,
                        preview: isNewer ? preview : inbox.preview,
                        target: isNewer ? target : inbox.target,
                        triggerCommentId: isNewer
                            ? target?.focusId || null
                            : inbox.triggerCommentId,
                        isVisible: true,
                        isRedacted: isNewer ? false : inbox.isRedacted,
                    },
                );

                // Complete outbox record
                await this.completeOwnedOutbox(
                    manager,
                    eventId,
                    attemptToken,
                    "completed",
                );

                return true;
            });
        } catch (error) {
            await this.relayService.recordFailure(
                eventId,
                attemptToken,
                error instanceof Error ? error : "delivery_failed",
                error instanceof NotificationIntentValidationError,
            );
            return false;
        }
    }

    private async completeOwnedOutbox(
        manager: EntityManager,
        id: string,
        token: string,
        state: "completed" | "suppressed",
        reason?: string,
    ) {
        const result = await manager
            .createQueryBuilder()
            .update(NotificationOutbox)
            .set({
                state,
                completedAt: new Date(),
                ownerToken: null,
                ownerExpiresAt: null,
                lastError: reason || null,
            })
            .where(
                "id = :id AND ownerToken = :token AND state = 'processing' AND ownerExpiresAt > CURRENT_TIMESTAMP(3)",
                { id, token },
            )
            .execute();
        if (result.affected !== 1)
            throw new Error("Notification ownership expired before commit");
    }

    private async resolveEventDetails(
        manager: EntityManager,
        outbox: NotificationOutbox,
    ): Promise<ResolvedEventDetails> {
        const payload = outbox.payload || {};
        const actorUserId = outbox.actorUserId || null;

        switch (outbox.eventType) {
            case "content.liked": {
                const { subjectType, subjectId } = payload;
                if (subjectType === "game")
                    return {
                        isSuppressed: true,
                        suppressionReason: "game_like_no_recipient",
                    } as ResolvedEventDetails;
                let rootType = subjectType as NotificationRootType;
                let rootId = subjectId;
                let source: any;
                let root: any;
                if (subjectType === "comment") {
                    const rows = await manager.query(
                        `SELECT 'post' AS rootType, postId AS rootId FROM post_comment WHERE id = ?
                        UNION ALL SELECT 'review', reviewId FROM review_comment WHERE id = ?
                        UNION ALL SELECT 'activity', activityId FROM activity_comment WHERE id = ?`,
                        [subjectId, subjectId, subjectId],
                    );
                    if (rows[0]) {
                        rootType = rows[0].rootType;
                        rootId = rows[0].rootId;
                        source = await lockNotificationComment(
                            manager,
                            rootType,
                            rootId,
                            subjectId,
                        );
                        root = source?.root;
                    }
                } else
                    source = root = await lockNotificationRoot(
                        manager,
                        rootType,
                        rootId,
                    );
                if (!source || !root)
                    return {
                        isSuppressed: true,
                        suppressionReason: "source_inaccessible",
                    } as ResolvedEventDetails;
                return {
                    recipientUserId: source.profileUserId,
                    actorUserId,
                    subjectType,
                    subjectId,
                    rootType,
                    rootId,
                    preview: { text: `Liked your ${subjectType}` },
                    target: await materializeNotificationTarget(
                        manager,
                        rootType,
                        rootId,
                        root,
                        subjectType === "comment" ? subjectId : undefined,
                    ),
                };
            }
            case "comment.created":
            case "comment.replied": {
                const { commentId, parentCommentId, rootType, rootId } =
                    payload;
                const comment = await lockNotificationComment(
                    manager,
                    rootType,
                    rootId,
                    commentId,
                );
                if (!comment)
                    return {
                        isSuppressed: true,
                        suppressionReason: "source_inaccessible",
                    } as ResolvedEventDetails;
                const isReply = outbox.eventType === "comment.replied";
                let recipient = comment.root.profileUserId;
                if (isReply) {
                    if (comment.childOfId !== parentCommentId)
                        return {
                            isSuppressed: true,
                            suppressionReason: "invalid_reply_parent",
                        } as ResolvedEventDetails;
                    const parent = await lockNotificationComment(
                        manager,
                        rootType,
                        rootId,
                        parentCommentId,
                    );
                    if (!parent)
                        return {
                            isSuppressed: true,
                            suppressionReason: "source_inaccessible",
                        } as ResolvedEventDetails;
                    recipient = parent.profileUserId;
                } else if (comment.childOfId)
                    return {
                        isSuppressed: true,
                        suppressionReason: "invalid_comment_kind",
                    } as ResolvedEventDetails;
                return {
                    recipientUserId: recipient,
                    actorUserId,
                    subjectType: isReply ? "comment" : rootType,
                    subjectId: isReply ? parentCommentId : rootId,
                    rootType,
                    rootId,
                    preview: {
                        text: extractSafePlainText(
                            comment.content,
                            isReply
                                ? "Replied to your comment"
                                : "Shared a comment",
                        ),
                    },
                    target: await materializeNotificationTarget(
                        manager,
                        rootType,
                        rootId,
                        comment.root,
                        commentId,
                    ),
                };
            }

            case "profile.followed": {
                const { followId } = payload;
                let followedUserId = outbox.recipientUserId;

                if (!followedUserId && followId) {
                    const rows = await manager.query(
                        `SELECT followedUserId FROM user_follow WHERE id = ?`,
                        [followId],
                    );
                    followedUserId = rows[0]?.followedUserId || null;
                }

                if (!followedUserId) {
                    return {
                        isSuppressed: true,
                        suppressionReason: "followed_user_not_found",
                    } as any;
                }

                return {
                    recipientUserId: followedUserId,
                    actorUserId,
                    subjectType: "profile",
                    subjectId: followedUserId,
                    rootType: "profile",
                    rootId: followedUserId,
                    preview: { text: "Started following you" },
                    target: { type: "profile", id: actorUserId || "" },
                };
            }

            case "import.discovery-completed": {
                const {
                    discoveryResultId,
                    provider,
                    gameCount,
                    importedCount,
                    skippedCount,
                    failedCount,
                    gameSample,
                } = payload;

                const recipientUserId = outbox.recipientUserId;
                if (!recipientUserId) {
                    return {
                        isSuppressed: true,
                        suppressionReason: "importer_no_recipient",
                    } as any;
                }

                const boundedSample = Array.isArray(gameSample)
                    ? gameSample.slice(0, 3).map((g: any) => ({
                          id: g.id,
                          title: extractSafePlainText(g.title, "Game").slice(
                              0,
                              100,
                          ),
                      }))
                    : [];

                return {
                    recipientUserId,
                    actorUserId: null, // system actor
                    subjectType: "importer",
                    subjectId: String(discoveryResultId || "discovery"),
                    rootType: "importer",
                    rootId: String(discoveryResultId || "discovery"),
                    preview: {
                        provider: String(provider || "unknown"),
                        gameCount: Number(gameCount || 0),
                        importedCount: Number(importedCount || 0),
                        skippedCount: Number(skippedCount || 0),
                        failedCount: Number(failedCount || 0),
                        gameSample: boundedSample,
                    },
                    target: {
                        type: "importer",
                        id: String(discoveryResultId),
                        provider: String(provider),
                    },
                };
            }

            case "moderation.applied": {
                const { action, safeReason, reportId } = payload;
                const recipientUserId = outbox.recipientUserId;

                if (!recipientUserId) {
                    return {
                        isSuppressed: true,
                        suppressionReason: "moderation_no_recipient",
                    } as any;
                }

                return {
                    recipientUserId,
                    actorUserId: null, // system actor - privileged reporter data never exposed!
                    subjectType: "moderation",
                    subjectId: String(reportId || action),
                    rootType: "moderation",
                    rootId: String(reportId || action),
                    preview: {
                        text: `Moderation notice: ${action}`,
                        action,
                        reason: safeReason
                            ? extractSafePlainText(
                                  safeReason,
                                  "Moderation notice",
                              )
                            : undefined,
                    },
                    target: {
                        type: "profile",
                        id: recipientUserId,
                    },
                };
            }

            default:
                return {
                    isSuppressed: true,
                    suppressionReason: `unknown_event_type_${outbox.eventType}`,
                } as any;
        }
    }
}
