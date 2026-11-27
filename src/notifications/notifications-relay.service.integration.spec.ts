import "reflect-metadata";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import {
    NOTIFICATIONS_JOB_RETENTION_COMPLETE,
    NOTIFICATIONS_JOB_RETENTION_FAIL,
    NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
} from "./notifications.constants";

describe("NotificationsRelayService", () => {
    let dataSource: DataSource;
    let relayService: NotificationsRelayService;
    let mockQueue: { add: jest.Mock };

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    beforeEach(async () => {
        mockQueue = {
            add: jest.fn().mockResolvedValue({ id: "job-1" }),
        };
        relayService = new NotificationsRelayService(
            dataSource,
            dataSource.getRepository(NotificationOutbox),
            mockQueue as any,
        );
        await dataSource.query("DELETE FROM notification_outbox");
    });

    it("exposes only bounded aggregate diagnostics without identities or payloads", async () => {
        const diagnostics = await relayService.getDiagnostics();
        expect(Object.keys(diagnostics).sort()).toEqual(
            [
                "pendingCount",
                "processingCount",
                "failedCount",
                "suppressedCount",
                "completedCount",
                "retryAttempts",
                "oldestPendingAgeMs",
                "averageCompletionLatencyMs",
                "maximumCompletionLatencyMs",
            ].sort(),
        );
        for (const value of Object.values(diagnostics))
            expect(value === null || typeof value === "number").toBe(true);
    });

    it("verifies two relay instances do not concurrently claim the same event", async () => {
        const repo = dataSource.getRepository(NotificationOutbox);
        const eventId = `test-relay-race-${randomUUID()}`;

        await repo.save(
            repo.create({
                id: eventId,
                eventType: "content.liked",
                eventVersion: 1,
                occurredAt: new Date(),
                recipientUserId: "user-1",
                actorUserId: "user-2",
                payload: {
                    likeId: 1,
                    subjectType: "review",
                    subjectId: "rev-1",
                },
                state: "pending",
                attempts: 0,
                nextAttemptAt: new Date(Date.now() - 1000), // due
            }),
        );

        // Run two claim attempts concurrently
        const [claim1, claim2] = await Promise.all([
            relayService.claimDueRows(10, 30000),
            relayService.claimDueRows(10, 30000),
        ]);

        const claimed1 = claim1.filter((r) => r.id === eventId);
        const claimed2 = claim2.filter((r) => r.id === eventId);

        // Exactly one relay instance claimed it
        expect(claimed1.length + claimed2.length).toBe(1);

        // Cleanup
        await repo.delete({ id: eventId });
    });

    it("recovers a commit-before-enqueue crash after owner expiry", async () => {
        const repo = dataSource.getRepository(NotificationOutbox);
        const eventId = `test-crash-${randomUUID()}`;

        // Insert event simulating a process that claimed it, then crashed before enqueuing
        await repo.save(
            repo.create({
                id: eventId,
                eventType: "comment.created",
                eventVersion: 1,
                occurredAt: new Date(),
                recipientUserId: "user-1",
                actorUserId: "user-2",
                payload: {
                    commentId: "c-1",
                    rootType: "review",
                    rootId: "r-1",
                },
                state: "processing",
                ownerToken: "old-crashed-token",
                ownerExpiresAt: new Date(Date.now() - 1000), // expired lease!
                attempts: 1,
                nextAttemptAt: new Date(Date.now() - 5000),
            }),
        );

        const claimed = await relayService.claimDueRows(10, 30000);
        expect(claimed.find((r) => r.id === eventId)).toBeUndefined();
        expect(await repo.findOneBy({ id: eventId })).toMatchObject({
            state: "pending",
            attempts: 1,
            ownerToken: null,
            lastError: "owner_expired",
        });
        await repo.update(
            { id: eventId },
            { nextAttemptAt: new Date(Date.now() - 1000) },
        );
        const recovered = (await relayService.claimDueRows(10, 30000)).find(
            (r) => r.id === eventId,
        );

        expect(recovered).toBeDefined();
        expect(recovered?.ownerToken).not.toBe("old-crashed-token");
        expect(recovered?.attempts).toBe(2);
        expect(recovered?.state).toBe("processing");

        // Cleanup
        await repo.delete({ id: eventId });
    });

    it("publishes claimed rows to BullMQ with 1 attempt and explicit retention outside db tx", async () => {
        const row = {
            id: "ev-100",
            ownerToken: "token-abc",
        } as NotificationOutbox;

        await relayService.publishClaimedRows([row]);

        expect(mockQueue.add).toHaveBeenCalledTimes(1);
        expect(mockQueue.add).toHaveBeenCalledWith(
            NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
            { eventId: "ev-100", attemptToken: "token-abc" },
            {
                jobId: "notification-ev-100-token-abc",
                attempts: 1,
                removeOnComplete: NOTIFICATIONS_JOB_RETENTION_COMPLETE,
                removeOnFail: NOTIFICATIONS_JOB_RETENTION_FAIL,
            },
        );
    });

    it("handles Redis publication failure without crashing or dropping intent", async () => {
        mockQueue.add.mockRejectedValueOnce(
            new Error("Redis connection refused"),
        );
        const row = {
            id: "ev-redis-down",
            ownerToken: "token-down",
        } as NotificationOutbox;

        await expect(
            relayService.publishClaimedRows([row]),
        ).resolves.toBeUndefined();
    });

    it.each(["transport", "expiry"])(
        "bounds repeated %s failures and keeps later events moving",
        async (failure) => {
            const repo = dataSource.getRepository(NotificationOutbox);
            const id = `finite-${randomUUID()}`;
            await repo.save({
                id,
                eventType: "profile.followed",
                eventVersion: 1,
                occurredAt: new Date(),
                payload: { followId: 1 },
                state: "pending",
                nextAttemptAt: new Date(Date.now() - 1000),
            });
            mockQueue.add.mockRejectedValue(
                new Error("redis://secret@private-host"),
            );
            try {
                for (let attempt = 1; attempt <= 6; attempt++) {
                    const claimed = (await relayService.claimDueRows()).filter(
                        (row) => row.id === id,
                    );
                    if (attempt <= 5) {
                        expect(claimed).toHaveLength(1);
                        if (failure === "transport")
                            await relayService.publishClaimedRows(claimed);
                        else {
                            await repo.update(
                                { id },
                                { ownerExpiresAt: new Date(Date.now() - 1000) },
                            );
                            expect(
                                (await relayService.claimDueRows()).some(
                                    (row) => row.id === id,
                                ),
                            ).toBe(false);
                        }
                    } else expect(claimed).toHaveLength(0);
                    const row = await repo.findOneByOrFail({ id });
                    expect(row.attempts).toBe(Math.min(attempt, 5));
                    expect(row.lastError).not.toContain("secret");
                    if (attempt < 5) {
                        expect(row.state).toBe("pending");
                        expect(row.nextAttemptAt.getTime()).toBeGreaterThan(
                            Date.now() - 1000,
                        );
                        await repo.update(
                            { id },
                            { nextAttemptAt: new Date(Date.now() - 1000) },
                        );
                    } else expect(row.state).toBe("failed");
                }
                if (failure === "transport")
                    expect(mockQueue.add).toHaveBeenCalledTimes(5);
                const laterId = `later-${randomUUID()}`;
                await repo.save({
                    id: laterId,
                    eventType: "profile.followed",
                    eventVersion: 1,
                    occurredAt: new Date(),
                    payload: { followId: 2 },
                    state: "pending",
                    nextAttemptAt: new Date(Date.now() - 1000),
                });
                expect(
                    (await relayService.claimDueRows()).some(
                        (row) => row.id === laterId,
                    ),
                ).toBe(true);
                await repo.delete({ id: laterId });
            } finally {
                await repo.delete({ id });
            }
        },
    );

    it.each([0, -1, 101, 1.5])(
        "rejects unbounded claim limits: %s",
        async (limit) => {
            await expect(relayService.claimDueRows(limit)).rejects.toThrow(
                RangeError,
            );
        },
    );

    it("transitions explicit outcomes: success, suppression, and poison failure", async () => {
        const repo = dataSource.getRepository(NotificationOutbox);
        const eventId = `test-outcome-${randomUUID()}`;
        const ownerToken = "active-token";

        const record = await repo.save(
            repo.create({
                id: eventId,
                eventType: "content.liked",
                eventVersion: 1,
                occurredAt: new Date(),
                recipientUserId: "user-1",
                actorUserId: "user-2",
                payload: {
                    likeId: 1,
                    subjectType: "review",
                    subjectId: "rev-1",
                },
                state: "processing",
                ownerToken,
                ownerExpiresAt: new Date(Date.now() + 30000),
                attempts: 1,
                nextAttemptAt: new Date(),
            }),
        );

        // Success outcome
        await relayService.recordSuccess(eventId, ownerToken);
        let updated = await repo.findOneBy({ id: eventId });
        expect(updated?.state).toBe("completed");
        expect(updated?.completedAt).not.toBeNull();
        expect(updated?.ownerToken).toBeNull();

        // Reset to processing for suppression test
        await repo.update(
            { id: eventId },
            { state: "processing", ownerToken, completedAt: null },
        );
        await relayService.recordSuppression(
            eventId,
            ownerToken,
            "self_notification",
        );
        updated = await repo.findOneBy({ id: eventId });
        expect(updated?.state).toBe("suppressed");
        expect(updated?.lastError).toBe("self_notification");

        // Reset for poison event test
        await repo.update(
            { id: eventId },
            { state: "processing", ownerToken, completedAt: null },
        );
        await relayService.recordFailure(
            eventId,
            ownerToken,
            new Error("Poison event malformed"),
            true, // isPoison
        );
        updated = await repo.findOneBy({ id: eventId });
        expect(updated?.state).toBe("failed");
        expect(updated?.lastError).toBe("invalid_event");

        // Cleanup
        await repo.delete({ id: eventId });
    });

    it("applies exponential backoff on retry and marks failed on exhausted attempts", async () => {
        const repo = dataSource.getRepository(NotificationOutbox);
        const eventId = `test-backoff-${randomUUID()}`;
        const ownerToken = "backoff-token";

        // Attempt 1 fails -> backoff to pending
        await repo.save(
            repo.create({
                id: eventId,
                eventType: "content.liked",
                eventVersion: 1,
                occurredAt: new Date(),
                recipientUserId: "user-1",
                actorUserId: "user-2",
                payload: {
                    likeId: 1,
                    subjectType: "review",
                    subjectId: "rev-1",
                },
                state: "processing",
                ownerToken,
                attempts: 1,
                nextAttemptAt: new Date(),
            }),
        );

        await relayService.recordFailure(
            eventId,
            ownerToken,
            "Temporary error",
            false,
        );
        let updated = await repo.findOneBy({ id: eventId });
        expect(updated?.state).toBe("pending");
        expect(updated?.nextAttemptAt.getTime()).toBeGreaterThan(
            Date.now() - 100,
        );

        // Exhausted attempts (attempts = 5)
        await repo.update(
            { id: eventId },
            { state: "processing", ownerToken, attempts: 5 },
        );
        await relayService.recordFailure(
            eventId,
            ownerToken,
            "Final failure",
            false,
        );
        updated = await repo.findOneBy({ id: eventId });
        expect(updated?.state).toBe("failed");
        expect(updated?.lastError).toBe("delivery_failed");

        // Rearm event
        const rearmed = await relayService.rearmEvent(eventId);
        expect(rearmed).toBe(true);
        updated = await repo.findOneBy({ id: eventId });
        expect(updated?.state).toBe("pending");
        expect(updated?.attempts).toBe(0);
        expect(updated?.lastError).toBeNull();

        // New claim after rearm produces a fresh attempt token and distinct job ID
        const [reclaimed] = await relayService.claimDueRows(10, 30000);
        expect(reclaimed.id).toBe(eventId);
        expect(reclaimed.ownerToken).not.toBe(ownerToken);
        expect(reclaimed.ownerToken).not.toBeNull();

        await relayService.publishClaimedRows([reclaimed]);
        expect(mockQueue.add).toHaveBeenLastCalledWith(
            NOTIFICATIONS_PROCESS_OUTBOX_JOB_NAME,
            { eventId, attemptToken: reclaimed.ownerToken },
            expect.objectContaining({
                jobId: `notification-${eventId}-${reclaimed.ownerToken}`,
                attempts: 1,
            }),
        );

        // Cleanup
        await repo.delete({ id: eventId });
    });
});
