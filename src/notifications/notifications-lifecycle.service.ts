import { Injectable, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationOutbox } from "./entity/notification-outbox.entity";

export type NotificationRootType = "post" | "review" | "activity";

// Only existence/access metadata is consulted; presentation comes from the inbox.
export const NOTIFICATION_ELIGIBILITY_SQL = `
    (COALESCE(inbox.rootType, '') NOT IN ('post', 'review', 'activity')
     OR (inbox.rootType = 'post' AND EXISTS (SELECT 1 FROM post p WHERE p.id = inbox.rootId AND p.deletedAt IS NULL))
     OR (inbox.rootType = 'review' AND EXISTS (SELECT 1 FROM review r WHERE r.id = inbox.rootId
        AND (NOT EXISTS (SELECT 1 FROM collection_entry_collections_collection m WHERE m.collectionEntryId = r.collectionEntryId)
          OR EXISTS (SELECT 1 FROM collection_entry_collections_collection m JOIN collection c ON c.id = m.collectionId
                     WHERE m.collectionEntryId = r.collectionEntryId AND c.isPublic = 1))))
     OR (inbox.rootType = 'activity' AND EXISTS (SELECT 1 FROM activity a WHERE a.id = inbox.rootId
        AND (a.postId IS NULL OR EXISTS (SELECT 1 FROM post p WHERE p.id = a.postId AND p.deletedAt IS NULL))
        AND (a.reviewId IS NULL OR EXISTS (SELECT 1 FROM review r WHERE r.id = a.reviewId
            AND (NOT EXISTS (SELECT 1 FROM collection_entry_collections_collection m WHERE m.collectionEntryId = r.collectionEntryId)
              OR EXISTS (SELECT 1 FROM collection_entry_collections_collection m JOIN collection c ON c.id = m.collectionId
                         WHERE m.collectionEntryId = r.collectionEntryId AND c.isPublic = 1))))
        AND (a.collectionId IS NULL OR EXISTS (SELECT 1 FROM collection c WHERE c.id = a.collectionId AND c.isPublic = 1))
        AND (a.collectionEntryId IS NULL OR EXISTS (SELECT 1 FROM collection_entry e WHERE e.id = a.collectionEntryId
            AND (NOT EXISTS (SELECT 1 FROM collection_entry_collections_collection m WHERE m.collectionEntryId = e.id)
              OR EXISTS (SELECT 1 FROM collection_entry_collections_collection m JOIN collection c ON c.id = m.collectionId
                         WHERE m.collectionEntryId = e.id AND c.isPublic = 1)))))))
    AND (COALESCE(inbox.subjectType, '') <> 'comment'
      OR (inbox.rootType = 'post' AND EXISTS (SELECT 1 FROM post_comment c WHERE c.id = inbox.subjectId AND c.postId = inbox.rootId))
      OR (inbox.rootType = 'review' AND EXISTS (SELECT 1 FROM review_comment c WHERE c.id = inbox.subjectId AND c.reviewId = inbox.rootId))
      OR (inbox.rootType = 'activity' AND EXISTS (SELECT 1 FROM activity_comment c WHERE c.id = inbox.subjectId AND c.activityId = inbox.rootId)))
    AND (JSON_EXTRACT(inbox.target, '$.focusId') IS NULL
      OR (inbox.rootType = 'post' AND EXISTS (SELECT 1 FROM post_comment c WHERE c.id = JSON_UNQUOTE(JSON_EXTRACT(inbox.target, '$.focusId')) AND c.postId = inbox.rootId))
      OR (inbox.rootType = 'review' AND EXISTS (SELECT 1 FROM review_comment c WHERE c.id = JSON_UNQUOTE(JSON_EXTRACT(inbox.target, '$.focusId')) AND c.reviewId = inbox.rootId))
      OR (inbox.rootType = 'activity' AND EXISTS (SELECT 1 FROM activity_comment c WHERE c.id = JSON_UNQUOTE(JSON_EXTRACT(inbox.target, '$.focusId')) AND c.activityId = inbox.rootId)))`;

/** Locks the owning context before projection/reactions can use its snapshot. */
export async function lockNotificationRoot(
    manager: EntityManager,
    type: NotificationRootType,
    id: string,
): Promise<any | null> {
    if (type === "post") {
        const rows = await manager.query(
            "SELECT id, profileUserId, gameId FROM post WHERE id = ? AND deletedAt IS NULL FOR UPDATE",
            [id],
        );
        return rows[0] || null;
    }
    if (type === "review") {
        const rows = await manager.query(
            "SELECT id, profileUserId, gameId, collectionEntryId FROM review WHERE id = ? FOR UPDATE",
            [id],
        );
        if (!rows[0]) return null;
        const collections = await manager.query(
            `SELECT c.id, c.isPublic FROM collection c
            JOIN collection_entry_collections_collection m ON m.collectionId = c.id
            WHERE m.collectionEntryId = ? ORDER BY c.id FOR UPDATE`,
            [rows[0].collectionEntryId],
        );
        return collections.length && !collections.some((c: any) => c.isPublic)
            ? null
            : rows[0];
    }
    if (type === "activity") {
        const candidates = await manager.query(
            `SELECT id, profileUserId, type, postId, reviewId, collectionId, collectionEntryId,
            userFollowId, obtainedGameAchievementActivityId FROM activity WHERE id = ?`,
            [id],
        );
        const candidate = candidates[0];
        if (!candidate) return null;
        let context: any = null;
        if (candidate.postId)
            context = await lockNotificationRoot(
                manager,
                "post",
                candidate.postId,
            );
        else if (candidate.reviewId)
            context = await lockNotificationRoot(
                manager,
                "review",
                candidate.reviewId,
            );
        else if (candidate.collectionId) {
            const collections = await manager.query(
                "SELECT id, isPublic FROM collection WHERE id = ? FOR UPDATE",
                [candidate.collectionId],
            );
            if (!collections[0]?.isPublic) return null;
        }
        if ((candidate.postId || candidate.reviewId) && !context) return null;
        if (candidate.collectionEntryId) {
            const entries = await manager.query(
                "SELECT id, gameId FROM collection_entry WHERE id = ? FOR UPDATE",
                [candidate.collectionEntryId],
            );
            if (!entries[0]) return null;
            const collections = await manager.query(
                `SELECT c.id, c.isPublic FROM collection c
                JOIN collection_entry_collections_collection m ON m.collectionId = c.id
                WHERE m.collectionEntryId = ? ORDER BY c.id FOR UPDATE`,
                [candidate.collectionEntryId],
            );
            if (collections.length && !collections.some((c: any) => c.isPublic))
                return null;
            context ||= entries[0];
        }
        const rows = await manager.query(
            "SELECT id, profileUserId, type, postId, reviewId, collectionId, collectionEntryId, userFollowId, obtainedGameAchievementActivityId FROM activity WHERE id = ? FOR UPDATE",
            [id],
        );
        if (
            !rows[0] ||
            ["postId", "reviewId", "collectionId", "collectionEntryId"].some(
                (key) => rows[0][key] !== candidate[key],
            )
        )
            return null;
        return { ...rows[0], gameId: context?.gameId };
    }
    return null;
}

export async function lockNotificationComment(
    manager: EntityManager,
    rootType: NotificationRootType,
    rootId: string,
    id: string,
) {
    if (!["post", "review", "activity"].includes(rootType)) return null;
    const root = await lockNotificationRoot(manager, rootType, rootId);
    if (!root) return null;
    const rows = await manager.query(
        `SELECT id, profileUserId, content, childOfId FROM ${rootType}_comment WHERE id = ? AND ${rootType}Id = ? FOR UPDATE`,
        [id, rootId],
    );
    return rows[0] ? { ...rows[0], root } : null;
}

@Injectable()
export class NotificationsLifecycleService {
    constructor(
        @InjectRepository(NotificationInbox)
        private readonly inboxRepo: Repository<NotificationInbox>,
        @InjectRepository(NotificationEvent)
        private readonly eventRepo: Repository<NotificationEvent>,
        @Optional()
        private readonly dataSource?: DataSource,
    ) {}

    /**
     * Hides all inbox items referencing a deleted/hidden subject or root.
     * E.g. post soft deletion, review deletion, activity deletion.
     */
    async invalidateContent(
        contentType: "post" | "review" | "activity",
        contentId: string,
        manager?: EntityManager,
    ): Promise<void> {
        const em =
            manager || this.dataSource?.manager || this.inboxRepo.manager;
        const activities: Array<{ id: string }> =
            contentType === "activity"
                ? []
                : await em.query(
                      `SELECT id FROM activity WHERE ${contentType}Id = ?`,
                      [contentId],
                  );
        await em
            .createQueryBuilder()
            .update(NotificationInbox)
            .set({ isVisible: false })
            .where(
                "(subjectType = :contentType AND subjectId = :contentId) OR (rootType = :contentType AND rootId = :contentId)",
                {
                    contentType,
                    contentId: String(contentId),
                },
            )
            .execute();
        for (const activity of activities) {
            await this.invalidateContent("activity", activity.id, em);
        }
    }

    /**
     * Handles comment deletion:
     * If the deleted comment is the focus or latest excerpt in an inbox group:
     * - If other events exist in the group: redacts the excerpt and clears focusId, keeping the item visible and unread version intact.
     * - If no other events exist: hides the inbox item (isVisible = false).
     */
    async invalidateComment(
        commentId: string,
        manager?: EntityManager,
    ): Promise<void> {
        const exec = async (em: EntityManager) => {
            const inboxRepo = em.getRepository(NotificationInbox);
            const eventRepo = em.getRepository(NotificationEvent);

            const matchingEvents = await eventRepo
                .createQueryBuilder("event")
                .select("DISTINCT event.groupKey", "groupKey")
                .where(
                    "event.subjectType = 'comment' AND event.subjectId = :commentId",
                    { commentId },
                )
                .orWhere("event.triggerCommentId = :commentId", { commentId })
                .getRawMany();
            const matchingInbox = await inboxRepo
                .createQueryBuilder("inbox")
                .select("inbox.groupKey", "groupKey")
                .where(
                    "inbox.subjectType = 'comment' AND inbox.subjectId = :commentId",
                    { commentId },
                )
                .orWhere("inbox.triggerCommentId = :commentId", { commentId })
                .getRawMany();
            const groupKeys: string[] = [
                ...new Set<string>(
                    [...matchingEvents, ...matchingInbox].map(
                        (row) => row.groupKey,
                    ),
                ),
            ].sort();
            for (const groupKey of groupKeys) {
                const item = await inboxRepo.findOne({
                    where: { groupKey },
                    lock: { mode: "pessimistic_write" },
                });
                if (!item || !item.isVisible) continue;
                if (
                    item.subjectType === "comment" &&
                    item.subjectId === commentId
                ) {
                    await inboxRepo.update(
                        { id: item.id },
                        { isVisible: false },
                    );
                    continue;
                }
                if (item.triggerCommentId !== commentId && !item.isRedacted) continue;
                const active = await em.query(
                    `SELECT e.id FROM notification_event e
                    WHERE e.recipientUserId = ? AND e.groupKey = ? AND e.triggerCommentId <> ? AND (
                        (e.rootType = 'post' AND EXISTS (SELECT 1 FROM post_comment c WHERE c.id = e.triggerCommentId AND c.postId = e.rootId)) OR
                        (e.rootType = 'review' AND EXISTS (SELECT 1 FROM review_comment c WHERE c.id = e.triggerCommentId AND c.reviewId = e.rootId)) OR
                        (e.rootType = 'activity' AND EXISTS (SELECT 1 FROM activity_comment c WHERE c.id = e.triggerCommentId AND c.activityId = e.rootId)))
                    LIMIT 1 FOR UPDATE`,
                    [item.recipientUserId, groupKey, commentId],
                );
                const target = item.target ? { ...item.target } : null;
                if (target) delete target.focusId;
                await inboxRepo.update(
                    { id: item.id },
                    {
                        isVisible: active.length > 0,
                        isRedacted: true,
                        preview: { text: "[Comment deleted]" } as any,
                        target,
                        triggerCommentId: null,
                    },
                );
            }
        };

        if (manager) {
            await exec(manager);
        } else if (this.dataSource?.transaction) {
            await this.dataSource.transaction(exec);
        } else {
            await exec(this.inboxRepo.manager);
        }
    }

    /**
     * Invalidate all inbox items when a collection is made private.
     */
    async invalidateCollection(
        collectionId: string,
        manager?: EntityManager,
    ): Promise<void> {
        const em =
            manager ||
            this.dataSource?.createEntityManager() ||
            this.inboxRepo.manager;
        const reviews = await em.query(
            `SELECT r.id FROM review r
             JOIN collection_entry_collections_collection cecc ON cecc.collectionEntryId = r.collectionEntryId
             WHERE cecc.collectionId = ?`,
            [collectionId],
        );

        for (const row of reviews) {
            await this.invalidateContent("review", row.id, em);
        }
        const activities = await em.query(
            `SELECT DISTINCT a.id FROM activity a
            LEFT JOIN collection_entry_collections_collection m ON m.collectionEntryId = a.collectionEntryId
            WHERE a.collectionId = ? OR m.collectionId = ?`,
            [collectionId, collectionId],
        );
        for (const row of activities)
            await this.invalidateContent("activity", row.id, em);
    }

    async invalidateProfile(
        userId: string,
        manager: EntityManager,
    ): Promise<void> {
        for (const type of ["post", "review", "activity"] as const) {
            const rows = await manager.query(
                `SELECT id FROM ${type} WHERE profileUserId = ? ORDER BY id FOR UPDATE`,
                [userId],
            );
            for (const row of rows)
                await this.invalidateContent(type, row.id, manager);
        }
        await manager
            .createQueryBuilder()
            .update(NotificationOutbox)
            .set({
                state: "suppressed",
                ownerToken: null,
                ownerExpiresAt: null,
                completedAt: new Date(),
                lastError: "recipient_removed",
            })
            .where(
                "recipientUserId = :userId AND state IN ('pending', 'processing')",
                { userId },
            )
            .execute();
        await manager.update(
            NotificationInbox,
            { recipientUserId: userId },
            { isVisible: false },
        );
    }
}
