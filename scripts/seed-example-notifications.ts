import "reflect-metadata";
import { AppDataSource } from "../data-source";
import { NotificationOutbox } from "../src/notifications/entity/notification-outbox.entity";
import { NotificationEvent } from "../src/notifications/entity/notification-event.entity";
import { NotificationInbox } from "../src/notifications/entity/notification-inbox.entity";
import { NotificationsService } from "../src/notifications/notifications.service";
import { Profile } from "../src/profile/entities/profile.entity";

async function main() {
    const recipientUserId = process.argv[2] || "3b3eff61-392a-4c09-b2af-414d9c27b483";
    console.log(`Seeding organic example notifications for recipient: ${recipientUserId}`);

    await AppDataSource.initialize();
    const queryRunner = AppDataSource.createQueryRunner();

    try {
        // 1. Verify recipient profile exists
        const recipientProfile = await queryRunner.query(
            "SELECT userId, username FROM profile WHERE userId = ?",
            [recipientUserId],
        );
        if (!recipientProfile[0]) {
            throw new Error(`Recipient profile not found for userId: ${recipientUserId}`);
        }
        console.log(`Found recipient profile: ${recipientProfile[0].username} (${recipientUserId})`);

        // 2. Select actor profiles (prefer named actors if present, else fallback)
        const preferredActorUsernames = ["contract_actor", "actor_0c571c", "actor_6d33fd", "contract_recip", "other_0edd16"];
        let actorRows = await queryRunner.query(
            "SELECT userId, username FROM profile WHERE username IN (?) AND userId != ?",
            [preferredActorUsernames, recipientUserId],
        );
        if (actorRows.length < 3) {
            actorRows = await queryRunner.query(
                "SELECT userId, username FROM profile WHERE userId != ? LIMIT 5",
                [recipientUserId],
            );
        }
        if (actorRows.length < 3) {
            throw new Error("Need at least 3 other profiles in database to act as notification senders");
        }
        const actor1 = actorRows[0];
        const actor2 = actorRows[1];
        const actor3 = actorRows[2];
        const actor4 = actorRows[3] || actorRows[0];
        console.log(`Selected actors: ${actor1.username}, ${actor2.username}, ${actor3.username}, ${actor4.username}`);

        // Give actor1 an avatar if they don't have one, so frontend can test avatar rendering
        const actor1Profile = await queryRunner.query("SELECT avatarId FROM profile WHERE userId = ?", [actor1.userId]);
        if (!actor1Profile[0]?.avatarId) {
            await queryRunner.query(
                `INSERT INTO profile_avatar (filename, mimetype, extension, size, encoding, createdAt, updatedAt)
                 VALUES ('example-actor-avatar.jpg', 'image/jpeg', 'jpeg', 45000, '7bit', NOW(), NOW())`
            );
            const avatarRow = await queryRunner.query("SELECT LAST_INSERT_ID() AS id");
            await queryRunner.query("UPDATE profile SET avatarId = ? WHERE userId = ?", [avatarRow[0].id, actor1.userId]);
            console.log(`Assigned sample avatar ID ${avatarRow[0].id} to actor ${actor1.username}`);
        }

        // 3. Find a real game to attach posts/activities to
        const gameRows = await queryRunner.query("SELECT id, name, slug FROM game ORDER BY id LIMIT 1");
        const defaultGame = gameRows[0] || { id: 1942, name: "The Witcher 3: Wild Hunt", slug: "the-witcher-3-wild-hunt" };

        // 4. Clean up any previous seed records with deterministic IDs
        const seedPostId = "b0000000-0000-4000-8000-000000000001";
        const seedComment1Id = "b0000000-0000-4000-8000-000000000002";
        const seedUserCommentId = "b0000000-0000-4000-8000-000000000003";
        const seedReplyCommentId = "b0000000-0000-4000-8000-000000000004";
        const seedGroupPrefix = `${recipientUserId}:seed-example:`;

        await queryRunner.query("DELETE FROM notification_event WHERE recipientUserId = ? AND groupKey LIKE ?", [recipientUserId, `${seedGroupPrefix}%`]);
        await queryRunner.query("DELETE FROM notification_inbox WHERE recipientUserId = ? AND groupKey LIKE ?", [recipientUserId, `${seedGroupPrefix}%`]);
        await queryRunner.query("DELETE FROM notification_outbox WHERE id LIKE 'seed-notif-%'");

        await queryRunner.query("DELETE FROM post_comment WHERE id IN (?, ?, ?)", [seedReplyCommentId, seedUserCommentId, seedComment1Id]);
        await queryRunner.query("DELETE FROM post WHERE id = ?", [seedPostId]);
        await queryRunner.query("DELETE FROM user_follow WHERE followerUserId = ? AND followedUserId = ?", [actor4.userId, recipientUserId]);

        // 5. Create organic domain records
        // Post by recipient
        await queryRunner.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 2 HOUR))`,
            [seedPostId, recipientUserId, defaultGame.id, "Just finished the main storyline! Hands down one of the best RPG experiences ever made."]
        );

        // Comment by actor1 on recipient's post
        await queryRunner.query(
            `INSERT INTO post_comment (id, profileUserId, postId, content, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 45 MINUTE), DATE_SUB(NOW(), INTERVAL 45 MINUTE))`,
            [seedComment1Id, actor1.userId, seedPostId, "Totally agree, which faction ending did you end up getting?"]
        );

        // Recipient's own comment on the post
        await queryRunner.query(
            `INSERT INTO post_comment (id, profileUserId, postId, content, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 30 MINUTE), DATE_SUB(NOW(), INTERVAL 30 MINUTE))`,
            [seedUserCommentId, recipientUserId, seedPostId, "I went with the neutral path. The final confrontation was intense!"]
        );

        // Reply by actor2 to recipient's comment
        await queryRunner.query(
            `INSERT INTO post_comment (id, profileUserId, postId, childOfId, content, createdAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, DATE_SUB(NOW(), INTERVAL 10 MINUTE), DATE_SUB(NOW(), INTERVAL 10 MINUTE))`,
            [seedReplyCommentId, actor2.userId, seedPostId, seedUserCommentId, "That boss fight on Death March difficulty took me three days to beat."]
        );

        // Follow from actor4 to recipient
        await queryRunner.query(
            `INSERT INTO user_follow (followerUserId, followedUserId, createdAt, updatedAt)
             VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 3 HOUR), DATE_SUB(NOW(), INTERVAL 3 HOUR))`,
            [actor4.userId, recipientUserId]
        );
        const followRow = await queryRunner.query("SELECT LAST_INSERT_ID() AS id");
        const seedFollowId = followRow[0].id;

        // Check if recipient has an activity, or use an organic one
        const userActivityRows = await queryRunner.query(
            "SELECT id, type, obtainedGameAchievementActivityId FROM activity WHERE profileUserId = ? LIMIT 1",
            [recipientUserId]
        );
        const seedActivityId = userActivityRows[0]?.id || "645d51be-b78b-4e0e-a0b4-900ea58f1d1e";

        console.log("Organic domain records created / verified.");

        // 6. Build the 7 example notification groups
        const todayUtc = new Date().toISOString().slice(0, 10);
        const yesterdayUtc = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

        const notifications = [
            // Notification 1: Comment reply (Unread, single actor, focusId)
            {
                outboxId: "seed-notif-comment-reply",
                type: "comment.replied",
                groupKey: `${seedGroupPrefix}comment.replied:${seedUserCommentId}:${todayUtc}`,
                subjectType: "comment",
                subjectId: seedUserCommentId,
                rootType: "post",
                rootId: seedPostId,
                triggerCommentId: seedReplyCommentId,
                actorUserId: actor2.userId,
                actorIds: [actor2.userId],
                eventCount: 1,
                actorCount: 1,
                version: 1,
                readVersion: 0,
                lastEventAt: new Date(Date.now() - 10 * 60 * 1000), // 10 mins ago
                preview: { text: "That boss fight on Death March difficulty took me three days to beat." },
                target: { type: "post", id: seedPostId, focusId: seedReplyCommentId },
                payload: {
                    commentId: seedReplyCommentId,
                    parentCommentId: seedUserCommentId,
                    rootType: "post",
                    rootId: seedPostId,
                },
            },
            // Notification 2: Top-level comment on user's post (Unread, single actor, focusId)
            {
                outboxId: "seed-notif-comment-created",
                type: "comment.created",
                groupKey: `${seedGroupPrefix}comment.created:${seedPostId}:${todayUtc}`,
                subjectType: "post",
                subjectId: seedPostId,
                rootType: "post",
                rootId: seedPostId,
                triggerCommentId: seedComment1Id,
                actorUserId: actor1.userId,
                actorIds: [actor1.userId],
                eventCount: 1,
                actorCount: 1,
                version: 1,
                readVersion: 0,
                lastEventAt: new Date(Date.now() - 45 * 60 * 1000), // 45 mins ago
                preview: { text: "Totally agree, which faction ending did you end up getting?" },
                target: { type: "post", id: seedPostId, focusId: seedComment1Id },
                payload: {
                    commentId: seedComment1Id,
                    rootType: "post",
                    rootId: seedPostId,
                },
            },
            // Notification 3: Aggregated likes on user's post (Unread, 2 distinct actors, version 2)
            {
                outboxId: "seed-notif-post-liked-1",
                additionalOutbox: {
                    outboxId: "seed-notif-post-liked-2",
                    actorUserId: actor3.userId,
                    occurredAt: new Date(Date.now() - 60 * 60 * 1000),
                },
                type: "content.liked",
                groupKey: `${seedGroupPrefix}content.liked:post:${seedPostId}:${todayUtc}`,
                subjectType: "post",
                subjectId: seedPostId,
                rootType: "post",
                rootId: seedPostId,
                triggerCommentId: null,
                actorUserId: actor2.userId,
                actorIds: [actor3.userId, actor2.userId],
                eventCount: 2,
                actorCount: 2,
                version: 2,
                readVersion: 0,
                lastEventAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
                preview: { text: "Liked your post" },
                target: { type: "post", id: seedPostId },
                payload: {
                    likeId: 20001,
                    subjectType: "post",
                    subjectId: seedPostId,
                    rootType: "post",
                    rootId: seedPostId,
                },
            },
            // Notification 4: Profile followed (Unread, profile target)
            {
                outboxId: "seed-notif-profile-followed",
                type: "profile.followed",
                groupKey: `${seedGroupPrefix}profile.followed:${actor4.userId}`,
                subjectType: "profile",
                subjectId: recipientUserId,
                rootType: "profile",
                rootId: recipientUserId,
                triggerCommentId: null,
                actorUserId: actor4.userId,
                actorIds: [actor4.userId],
                eventCount: 1,
                actorCount: 1,
                version: 1,
                readVersion: 0,
                lastEventAt: new Date(Date.now() - 3 * 3600 * 1000), // 3 hours ago
                preview: { text: "Started following you" },
                target: { type: "profile", id: actor4.userId },
                payload: {
                    followId: seedFollowId,
                },
            },
            // Notification 5: Like on user's activity (Read, tests read state rendering)
            {
                outboxId: "seed-notif-activity-liked",
                type: "content.liked",
                groupKey: `${seedGroupPrefix}content.liked:activity:${seedActivityId}:${todayUtc}`,
                subjectType: "activity",
                subjectId: seedActivityId,
                rootType: "activity",
                rootId: seedActivityId,
                triggerCommentId: null,
                actorUserId: actor1.userId,
                actorIds: [actor1.userId],
                eventCount: 1,
                actorCount: 1,
                version: 1,
                readVersion: 1, // READ
                lastEventAt: new Date(Date.now() - 5 * 3600 * 1000), // 5 hours ago
                preview: { text: "Liked your activity" },
                target: {
                    type: "activity",
                    id: seedActivityId,
                    activityType: "OBTAINED_GAME_ACHIEVEMENT",
                    game: {
                        id: defaultGame.id,
                        name: defaultGame.name,
                        slug: defaultGame.slug,
                    },
                },
                payload: {
                    likeId: 20002,
                    subjectType: "activity",
                    subjectId: seedActivityId,
                    rootType: "activity",
                    rootId: seedActivityId,
                },
            },
            // Notification 6: Import discovery completed (Unread, importer target with sample games)
            {
                outboxId: "seed-notif-import-discovery",
                type: "import.discovery-completed",
                groupKey: `${seedGroupPrefix}import.discovery-completed:steam-discovery-42`,
                subjectType: "importer",
                subjectId: "steam-discovery-42",
                rootType: "importer",
                rootId: "steam-discovery-42",
                triggerCommentId: null,
                actorUserId: null,
                actorIds: [],
                eventCount: 1,
                actorCount: 0,
                version: 1,
                readVersion: 0,
                lastEventAt: new Date(Date.now() - 24 * 3600 * 1000), // Yesterday
                preview: {
                    provider: "steam",
                    gameCount: 42,
                    importedCount: 35,
                    skippedCount: 5,
                    failedCount: 2,
                    gameSample: [
                        { id: defaultGame.id, title: defaultGame.name },
                        { id: 1, title: "Thief II: The Metal Age" },
                        { id: 5, title: "Baldur's Gate" },
                    ],
                },
                target: {
                    type: "importer",
                    id: "steam-discovery-42",
                    provider: "steam",
                },
                payload: {
                    discoveryResultId: "steam-discovery-42",
                    provider: "steam",
                    gameCount: 42,
                    importedCount: 35,
                    skippedCount: 5,
                    failedCount: 2,
                    gameSample: [
                        { id: defaultGame.id, title: defaultGame.name },
                        { id: 1, title: "Thief II: The Metal Age" },
                        { id: 5, title: "Baldur's Gate" },
                    ],
                },
            },
            // Notification 7: Moderation notice (Read, system alert with safe reason)
            {
                outboxId: "seed-notif-moderation-applied",
                type: "moderation.applied",
                groupKey: `${seedGroupPrefix}moderation.applied:mod-report-101`,
                subjectType: "moderation",
                subjectId: "mod-report-101",
                rootType: "moderation",
                rootId: "mod-report-101",
                triggerCommentId: null,
                actorUserId: null,
                actorIds: [],
                eventCount: 1,
                actorCount: 0,
                version: 1,
                readVersion: 1, // READ
                lastEventAt: new Date(Date.now() - 48 * 3600 * 1000), // 2 days ago
                preview: {
                    text: "Moderation notice: alert",
                    action: "alert",
                    reason: "Reminder: please format and tag game spoilers when discussing final quest chapters.",
                },
                target: {
                    type: "profile",
                    id: recipientUserId,
                },
                payload: {
                    action: "alert",
                    safeReason: "Reminder: please format and tag game spoilers when discussing final quest chapters.",
                    reportId: 101,
                },
            },
        ];

        // 7. Insert outbox, event, and inbox records
        for (const notif of notifications) {
            // Outbox record(s)
            await queryRunner.query(
                `INSERT INTO notification_outbox 
                 (id, eventType, eventVersion, occurredAt, nextAttemptAt, recipientUserId, actorUserId, payload, state, completedAt, createdAt, updatedAt)
                 VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'completed', ?, NOW(), NOW())`,
                [
                    notif.outboxId,
                    notif.type,
                    notif.lastEventAt,
                    notif.lastEventAt,
                    recipientUserId,
                    notif.actorUserId,
                    JSON.stringify(notif.payload),
                    notif.lastEventAt,
                ]
            );

            // Event record 1
            await queryRunner.query(
                `INSERT INTO notification_event
                 (eventId, recipientUserId, groupKey, eventType, actorUserId, subjectType, subjectId, rootType, rootId, triggerCommentId, preview, target, occurredAt, createdAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                [
                    notif.outboxId,
                    recipientUserId,
                    notif.groupKey,
                    notif.type,
                    notif.actorUserId,
                    notif.subjectType,
                    notif.subjectId,
                    notif.rootType,
                    notif.rootId,
                    notif.triggerCommentId,
                    JSON.stringify(notif.preview),
                    JSON.stringify(notif.target),
                    notif.lastEventAt,
                ]
            );

            // If there's an additional outbox event for aggregation (e.g. multi-actor like):
            if (notif.additionalOutbox) {
                const add = notif.additionalOutbox;
                await queryRunner.query(
                    `INSERT INTO notification_outbox 
                     (id, eventType, eventVersion, occurredAt, nextAttemptAt, recipientUserId, actorUserId, payload, state, completedAt, createdAt, updatedAt)
                     VALUES (?, ?, 1, ?, ?, ?, ?, ?, 'completed', ?, NOW(), NOW())`,
                    [
                        add.outboxId,
                        notif.type,
                        add.occurredAt,
                        add.occurredAt,
                        recipientUserId,
                        add.actorUserId,
                        JSON.stringify(notif.payload),
                        add.occurredAt,
                    ]
                );
                await queryRunner.query(
                    `INSERT INTO notification_event
                     (eventId, recipientUserId, groupKey, eventType, actorUserId, subjectType, subjectId, rootType, rootId, triggerCommentId, preview, target, occurredAt, createdAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
                    [
                        add.outboxId,
                        recipientUserId,
                        notif.groupKey,
                        notif.type,
                        add.actorUserId,
                        notif.subjectType,
                        notif.subjectId,
                        notif.rootType,
                        notif.rootId,
                        notif.triggerCommentId,
                        JSON.stringify(notif.preview),
                        JSON.stringify(notif.target),
                        add.occurredAt,
                    ]
                );
            }

            // Materialized Inbox record
            await queryRunner.query(
                `INSERT INTO notification_inbox
                 (recipientUserId, groupKey, type, subjectType, subjectId, rootType, rootId, triggerCommentId, preview, target, actorIds, eventCount, actorCount, lastEventAt, version, readVersion, isVisible, isRedacted, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NOW(), NOW())`,
                [
                    recipientUserId,
                    notif.groupKey,
                    notif.type,
                    notif.subjectType,
                    notif.subjectId,
                    notif.rootType,
                    notif.rootId,
                    notif.triggerCommentId,
                    JSON.stringify(notif.preview),
                    JSON.stringify(notif.target),
                    JSON.stringify(notif.actorIds),
                    notif.eventCount,
                    notif.actorCount,
                    notif.lastEventAt,
                    notif.version,
                    notif.readVersion,
                ]
            );
        }

        console.log(`Successfully seeded ${notifications.length} notification items across notification_outbox, notification_event, and notification_inbox.`);

        // 8. Test reading via NotificationsService
        const inboxRepo = AppDataSource.getRepository(NotificationInbox);
        const profileRepo = AppDataSource.getRepository(Profile);
        const notificationsService = new NotificationsService(inboxRepo, profileRepo, AppDataSource);

        const result = await notificationsService.findAll(recipientUserId, { limit: 20 });
        console.log("\n--- Verification: GET /notifications Output ---");
        console.log(`Total notifications returned: ${result.data.length}`);
        console.log(`Unread count: ${result.unreadCount}`);
        console.log(`Has more: ${result.pagination.hasMore}`);
        console.log("\nSample items:");
        for (const item of result.data) {
            console.log(`- [${item.readVersion < item.version ? "UNREAD" : "READ"}] Type: ${item.type} | Actors: ${item.actors.map(a => a.username).join(", ") || "(none)"} | Preview: ${JSON.stringify(item.preview?.text || item.preview)} | Target: ${item.target?.type}`);
        }
        console.log("----------------------------------------------\n");

    } finally {
        await queryRunner.release();
        await AppDataSource.destroy();
    }
}

main().catch((err) => {
    console.error("Failed to seed example notifications:", err);
    process.exit(1);
});
