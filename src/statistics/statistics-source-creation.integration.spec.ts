import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { PostsService } from "../posts/posts.service";
import { Post } from "../posts/entity/post.entity";
import { ReviewsService } from "../reviews/reviews.service";
import { Review } from "../reviews/entities/review.entity";
import { ActivitiesRepositoryService } from "../activities/activities-repository/activities-repository.service";
import { Activity } from "../activities/activities-repository/entities/activity.entity";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";
import { CommentService } from "../comment/comment.service";
import { CommentSourceType } from "../comment/comment.constants";
import { CollectionsEntriesService } from "../collections/collections-entries/collections-entries.service";
import { CollectionEntry } from "../collections/collections-entries/entities/collection-entry.entity";
import { CollectionEntryToCollection } from "../collections/collections-entries/entities/collection-entry-to-collection.entity";
import { NotificationsLifecycleService } from "../notifications/notifications-lifecycle.service";
import { NotificationInbox } from "../notifications/entity/notification-inbox.entity";
import { NotificationEvent } from "../notifications/entity/notification-event.entity";
import { ensureStatisticsTarget, STATISTICS_SOURCE_TABLES } from "./statistics-target.repository";
import { StatisticsSourceType } from "./statistics.constants";

describe("source creation after statistics retirement", () => {
    let dataSource: DataSource;
    beforeAll(async () => { dataSource = await createNotificationTestDataSource(); });
    afterAll(async () => { if (dataSource?.isInitialized) await dataSource.destroy(); });

    it("creates all content kinds with required targets and tombstones cascaded descendants", async () => {
        const owner = randomUUID();
        const entryId = randomUUID();
        const collectionId = randomUUID();
        await dataSource.query("INSERT INTO profile (userId, username) VALUES (?, ?)", [owner, `source_${owner.slice(0, 12)}`]);
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [owner]);
        await dataSource.query("INSERT INTO collection (id, name, isPublic, libraryUserId) VALUES (?, 'Sources', 1, ?)", [collectionId, owner]);
        await dataSource.query("INSERT INTO collection_entry (id, gameId, libraryUserId, status) VALUES (?, 1, ?, 'planned')", [entryId, owner]);
        await dataSource.query("INSERT INTO collection_entry_collections_collection (collectionEntryId, collectionId) VALUES (?, ?)", [entryId, collectionId]);

        const types = Object.values(StatisticsSourceType).filter((type) => type !== StatisticsSourceType.GAME);
        try {
            for (const type of types) {
                const { table } = STATISTICS_SOURCE_TABLES[type];
                const missing = await dataSource.query(`SELECT id FROM ${table} WHERE statisticsTargetId IS NULL`);
                for (const row of missing)
                    await dataSource.transaction((manager) => ensureStatisticsTarget(manager, type, row.id));
                await dataSource.query(`ALTER TABLE ${table} MODIFY statisticsTargetId BIGINT UNSIGNED NOT NULL`);
            }
            const queue = { register: jest.fn(), addTrackingJob: jest.fn() };
            const lifecycle = new NotificationsLifecycleService(dataSource.getRepository(NotificationInbox), dataSource.getRepository(NotificationEvent), dataSource);
            const posts = new PostsService(dataSource.getRepository(Post) as any, {} as any, queue as any, lifecycle);
            await posts.create(owner, { content: "Required target", gameId: 1 });
            const post = await dataSource.getRepository(Post).findOneByOrFail({ profileUserId: owner });
            const reviews = new ReviewsService(dataSource.getRepository(Review), queue as any, {
                findOneByUserIdAndGameIdOrFail: async () => ({ id: entryId }),
            } as any, queue as any, { registerLevelExpIncreaseActivity: jest.fn() } as any, lifecycle);
            await reviews.createOrUpdate(owner, { gameId: 1, rating: 4 } as any);
            const review = await dataSource.getRepository(Review).findOneByOrFail({ profileUserId: owner });
            const activities = new ActivitiesRepositoryService(dataSource.getRepository(Activity), reviews, {} as any,
                { isMature: async () => false } as any, { checkIsSuspendedOrBanned: async () => false } as any, posts, {} as any);
            const activity = await activities.create({ type: ActivityType.POST, sourceId: post.id, profileUserId: owner });
            const comments = new CommentService(dataSource, lifecycle);
            const targetIds = [post.statisticsTargetId, review.statisticsTargetId, activity!.statisticsTargetId];
            for (const [type, id] of [[CommentSourceType.POST, post.id], [CommentSourceType.REVIEW, review.id], [CommentSourceType.ACTIVITY, activity!.id]] as const) {
                const comment = await comments.create(owner, { sourceType: type, sourceId: id, content: "Required target" });
                const [stored] = await dataSource.query(`SELECT statisticsTargetId FROM ${type}_comment WHERE id = ?`, [comment.id]);
                targetIds.push(Number(stored.statisticsTargetId));
                if (type === CommentSourceType.POST) {
                    const reply = await comments.create(owner, { sourceType: type, sourceId: id, content: "Reply", childOf: comment.id });
                    const [storedReply] = await dataSource.query("SELECT statisticsTargetId FROM post_comment WHERE id = ?", [reply.id]);
                    targetIds.push(Number(storedReply.statisticsTargetId));
                    await comments.delete(owner, comment.id, { sourceType: type });
                    expect(await dataSource.query("SELECT isActive FROM statistics_target WHERE id IN (?)", [[stored.statisticsTargetId, storedReply.statisticsTargetId]]))
                        .toEqual([{ isActive: 0 }, { isActive: 0 }]);
                }
            }
            expect(new Set(targetIds).size).toBe(7);
            expect(targetIds.every((id) => Number.isSafeInteger(id) && Number(id) > 0)).toBe(true);
            expect(await dataSource.query("SELECT COUNT(*) AS count FROM statistics_event WHERE targetId IN (?)", [targetIds])).toEqual([{ count: 0 }]);
            const entries = new CollectionsEntriesService(dataSource.getRepository(CollectionEntry), dataSource.getRepository(CollectionEntryToCollection),
                {} as any, {} as any, {} as any, {} as any, {} as any, lifecycle);
            await entries.delete(owner, entryId);
            await posts.delete(owner, post.id);
            expect(await dataSource.query("SELECT COUNT(*) AS count FROM statistics_target WHERE id IN (?) AND isActive = 1", [targetIds])).toEqual([{ count: 0 }]);
        } finally {
            for (const type of types)
                await dataSource.query(`ALTER TABLE ${STATISTICS_SOURCE_TABLES[type].table} MODIFY statisticsTargetId BIGINT UNSIGNED NULL`);
        }
    });
});
