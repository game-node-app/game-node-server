import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { randomUUID } from "crypto";
import { NotificationsService } from "./notifications.service";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { Profile } from "../profile/entities/profile.entity";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationsProjectorService } from "./notifications-projector.service";
import { StatisticsService } from "../statistics/statistics.service";
import { StatisticsSourceType } from "../statistics/statistics.constants";

function computePercentiles(values: number[]) {
    const sorted = [...values].sort((a, b) => a - b);
    return {
        p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        p99: sorted[Math.floor(sorted.length * 0.99)] ?? 0,
    };
}

describe("Notifications Operational Benchmarks (Task 9.3 & 15.4)", () => {
    let dataSource: DataSource;
    let service: NotificationsService;
    let relayService: NotificationsRelayService;
    let projectorService: NotificationsProjectorService;
    let statisticsService: StatisticsService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();

        service = new NotificationsService(
            dataSource.getRepository(NotificationInbox),
            dataSource.getRepository(Profile),
            dataSource,
        );

        relayService = new NotificationsRelayService(
            dataSource,
            dataSource.getRepository(NotificationOutbox),
            { add: async () => {} } as any,
        );

        projectorService = new NotificationsProjectorService(
            dataSource,
            relayService,
        );

        statisticsService = new StatisticsService(dataSource);
    });

    afterAll(async () => {
        if (dataSource && dataSource.isInitialized) {
            await dataSource.query("DELETE FROM notification_outbox");
            await dataSource.query("DELETE FROM notification_inbox");
            await dataSource.query("DELETE FROM notification_event");
            await dataSource.destroy();
        }
    });

    it("records query plans, payload sizes, commit-to-visible, query counts, and p50/p95/p99 latencies", async () => {
        // 1. Query plans EXPLAIN
        const explainPagination = await dataSource.query(
            `EXPLAIN SELECT * FROM notification_inbox
             WHERE recipientUserId = 'bench-recipient' AND isVisible = 1
             ORDER BY lastEventAt DESC, id DESC LIMIT 21`,
        );
        console.log("EXPLAIN Pagination:", JSON.stringify(explainPagination[0]));

        const explainUnread = await dataSource.query(
            `EXPLAIN SELECT COUNT(*) as cnt FROM notification_inbox
             WHERE recipientUserId = 'bench-recipient' AND isVisible = 1 AND readVersion < version`,
        );
        console.log("EXPLAIN Unread:", JSON.stringify(explainUnread[0]));

        // 2. Commit-to-visible latency measurement
        const recipientUser = randomUUID();
        const actorUser = randomUUID();
        await dataSource.query(
            `INSERT INTO profile (userId, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE userId = userId`,
            [recipientUser, `recip_${recipientUser.slice(0, 6)}`],
        );
        await dataSource.query(
            `INSERT INTO profile (userId, username) VALUES (?, ?) ON DUPLICATE KEY UPDATE userId = userId`,
            [actorUser, `actor_${actorUser.slice(0, 6)}`],
        );

        const startCommit = Date.now();
        const outboxId = randomUUID();
        await dataSource.getRepository(NotificationOutbox).save({
            id: outboxId,
            eventType: "profile.followed",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId: recipientUser,
            actorUserId: actorUser,
            payload: { followId: 1 },
            state: "processing",
            ownerToken: "bench-tok",
            ownerExpiresAt: new Date(Date.now() + 60000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });

        await projectorService.projectEvent(outboxId, "bench-tok");
        const commitToVisibleMs = Date.now() - startCommit;
        console.log(`Commit-to-visible latency: ${commitToVisibleMs} ms`);

        // Verify diagnostics
        const diagnostics = await relayService.getDiagnostics();
        expect(diagnostics.completedCount).toBeGreaterThanOrEqual(1);
        expect(diagnostics.retryAttempts).toBeGreaterThanOrEqual(0);
        console.log("Relay Diagnostics:", JSON.stringify(diagnostics));

        // 3. Populate 150 groups with mixed sources
        const baseDate = new Date();
        const inboxRepo = dataSource.getRepository(NotificationInbox);
        const itemsToInsert = [];
        for (let i = 0; i < 150; i++) {
            itemsToInsert.push(
                inboxRepo.create({
                    recipientUserId: recipientUser,
                    groupKey: `bench:group:${i}`,
                    type: i % 2 === 0 ? "content.liked" : "comment.created",
                    actorIds: [actorUser],
                    actorCount: 1,
                    eventCount: (i % 5) + 1,
                    preview: { text: `Preview text for group ${i}` },
                    target: { type: "post", id: randomUUID() },
                    lastEventAt: new Date(baseDate.getTime() - i * 60000),
                    version: (i % 3) + 1,
                    readVersion: i % 2 === 0 ? (i % 3) + 1 : 0,
                    isVisible: true,
                    isRedacted: false,
                }),
            );
        }
        await inboxRepo.save(itemsToInsert);

        // 4. Measure Query Counts (constant category-bounded queries)
        let queriesExecuted = 0;
        const originalQuery = dataSource.query.bind(dataSource);
        const querySpy = jest
            .spyOn(dataSource, "query")
            .mockImplementation(async (...args: any[]) => {
                queriesExecuted++;
                return (originalQuery as any)(...args);
            });

        queriesExecuted = 0;
        const sampleRes20 = await service.findAll(recipientUser, { limit: 20 });
        const queryCountLimit20 = queriesExecuted;

        queriesExecuted = 0;
        const sampleRes100 = await service.findAll(recipientUser, { limit: 100 });
        const queryCountLimit100 = queriesExecuted;
        querySpy.mockRestore();

        console.log(
            `Query counts -> Limit 20: ${queryCountLimit20} queries, Limit 100: ${queryCountLimit100} queries`,
        );
        expect(queryCountLimit20).toBeLessThanOrEqual(5);
        expect(queryCountLimit100).toBeLessThanOrEqual(5);

        // 5. Measure Read Latencies (p50 / p95 / p99) over 30 iterations
        const readLatencies20: number[] = [];
        for (let i = 0; i < 30; i++) {
            const t = Date.now();
            await service.findAll(recipientUser, { limit: 20 });
            readLatencies20.push(Date.now() - t);
        }
        const p20 = computePercentiles(readLatencies20);

        const readLatencies100: number[] = [];
        for (let i = 0; i < 30; i++) {
            const t = Date.now();
            await service.findAll(recipientUser, { limit: 100 });
            readLatencies100.push(Date.now() - t);
        }
        const p100 = computePercentiles(readLatencies100);

        const payloadSize20 = Buffer.byteLength(
            JSON.stringify(sampleRes20),
            "utf8",
        );
        const payloadSize100 = Buffer.byteLength(
            JSON.stringify(sampleRes100),
            "utf8",
        );

        // 6. Measure Reaction Latencies (p50 / p95 / p99) over 30 distinct reactions
        const benchPostId = randomUUID();
        await dataSource.query(
            `INSERT INTO post (id, profileUserId, gameId, content, createdAt, updatedAt)
             VALUES (?, ?, 1, 'Post for reaction benchmark', NOW(), NOW())`,
            [benchPostId, recipientUser],
        );

        const reactionLatencies: number[] = [];
        for (let i = 0; i < 30; i++) {
            const likerId = randomUUID();
            await dataSource.query(
                `INSERT INTO profile (userId, username, createdAt, updatedAt)
                 VALUES (?, ?, NOW(), NOW()) ON DUPLICATE KEY UPDATE userId = userId`,
                [likerId, `liker_${likerId.slice(0, 6)}`],
            );
            const t = Date.now();
            await statisticsService.applyReaction(
                likerId,
                {
                    sourceType: StatisticsSourceType.POST,
                    sourceId: benchPostId,
                },
                true,
            );
            reactionLatencies.push(Date.now() - t);
        }
        const pReaction = computePercentiles(reactionLatencies);

        console.log("BENCHMARK SUMMARY:");
        console.log(
            `Read Limit 20  -> p50: ${p20.p50} ms, p95: ${p20.p95} ms, p99: ${p20.p99} ms, payload: ${payloadSize20} B, items: ${sampleRes20.data.length}`,
        );
        console.log(
            `Read Limit 100 -> p50: ${p100.p50} ms, p95: ${p100.p95} ms, p99: ${p100.p99} ms, payload: ${payloadSize100} B, items: ${sampleRes100.data.length}`,
        );
        console.log(
            `Reaction Like  -> p50: ${pReaction.p50} ms, p95: ${pReaction.p95} ms, p99: ${pReaction.p99} ms (over 30 reactions)`,
        );
        console.log(`Commit-to-Visible Latency: ${commitToVisibleMs} ms`);

        expect(sampleRes20.data).toHaveLength(20);
        expect(sampleRes100.data).toHaveLength(100);
        expect(commitToVisibleMs).toBeLessThan(1000);
        expect(p20.p99).toBeLessThan(50);
        expect(p100.p99).toBeLessThan(100);
        expect(pReaction.p99).toBeLessThan(100);
    });
});
