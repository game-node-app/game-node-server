import "reflect-metadata";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import {
    appendNotificationIntent,
    NotificationIntentValidationError,
    validateNotificationIntent,
} from "./notifications-outbox.service";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";

describe("NotificationsOutboxService appendNotificationIntent", () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });

    it.each([
        {
            eventType: "content.liked",
            payload: { subjectType: "post", subjectId: "post-1" },
        },
        {
            eventType: "content.liked",
            payload: { likeId: -1, subjectType: "post", subjectId: "post-1" },
        },
        {
            eventType: "content.liked",
            payload: { likeId: 1, subjectType: "post", subjectId: "" },
        },
        {
            eventType: "comment.created",
            payload: { commentId: "c", rootType: "unknown", rootId: "r" },
        },
        {
            eventType: "comment.replied",
            payload: {
                commentId: "c",
                parentCommentId: "c",
                rootType: "post",
                rootId: "r",
            },
        },
        { eventType: "profile.followed", payload: { followId: 0 } },
        {
            eventType: "profile.followed",
            payload: { followId: 1, secret: "hidden" },
        },
        {
            eventType: "moderation.applied",
            payload: { action: "delete-account" },
        },
        {
            eventType: "moderation.applied",
            payload: { action: "ban", reportId: 0.5 },
        },
        {
            eventType: "import.discovery-completed",
            payload: {
                discoveryResultId: 1,
                provider: "steam",
                gameCount: -1,
                importedCount: 0,
                skippedCount: 0,
                failedCount: 0,
            },
        },
        { eventType: "profile.followed", payload: [] },
    ])(
        "rejects invalid event-specific payloads before persistence: %j",
        async (event) => {
            await expect(
                appendNotificationIntent(
                    {} as any,
                    {
                        ...event,
                        eventVersion: 1,
                        recipientUserId: "recipient",
                        actorUserId: "actor",
                    } as any,
                ),
            ).rejects.toThrow(NotificationIntentValidationError);
        },
    );

    it("rejects invalid occurrence dates", () => {
        expect(() =>
            validateNotificationIntent({
                eventType: "profile.followed",
                eventVersion: 1,
                occurredAt: new Date("invalid"),
                recipientUserId: "recipient",
                actorUserId: "actor",
                payload: { followId: 1 },
            }),
        ).toThrow("Invalid occurredAt");
    });

    it("rejects unsupported event version", async () => {
        await expect(
            appendNotificationIntent({} as any, {
                eventType: "content.liked",
                eventVersion: 2,
                recipientUserId: "user-1",
                actorUserId: "user-2",
                payload: {
                    likeId: 1,
                    subjectType: "review",
                    subjectId: "rev-1",
                },
            }),
        ).rejects.toThrow(NotificationIntentValidationError);
    });

    it("rejects invalid identities", async () => {
        // empty id string
        await expect(
            appendNotificationIntent({} as any, {
                id: "",
                eventType: "content.liked",
                eventVersion: 1,
                recipientUserId: "user-1",
                actorUserId: "user-2",
                payload: {
                    likeId: 1,
                    subjectType: "review",
                    subjectId: "rev-1",
                },
            }),
        ).rejects.toThrow(NotificationIntentValidationError);

        // empty recipientUserId
        await expect(
            appendNotificationIntent({} as any, {
                eventType: "content.liked",
                eventVersion: 1,
                recipientUserId: "   ",
                actorUserId: "user-2",
                payload: {
                    likeId: 1,
                    subjectType: "review",
                    subjectId: "rev-1",
                },
            }),
        ).rejects.toThrow(NotificationIntentValidationError);

        // oversized id
        await expect(
            appendNotificationIntent({} as any, {
                id: "a".repeat(256),
                eventType: "content.liked",
                eventVersion: 1,
                recipientUserId: "user-1",
                actorUserId: "user-2",
                payload: {
                    likeId: 1,
                    subjectType: "review",
                    subjectId: "rev-1",
                },
            }),
        ).rejects.toThrow(NotificationIntentValidationError);
    });

    it("rejects oversized payloads (> 64KB)", async () => {
        const largeString = "x".repeat(65537);
        await expect(
            appendNotificationIntent({} as any, {
                eventType: "content.liked",
                eventVersion: 1,
                recipientUserId: "user-1",
                actorUserId: "user-2",
                payload: {
                    likeId: 1,
                    subjectType: "review",
                    subjectId: "rev-1",
                    data: largeString,
                } as any,
            }),
        ).rejects.toThrow(/Oversized payload/);
    });

    it("successfully appends intent inside a transaction", async () => {
        const eventId = `test-intent-${randomUUID()}`;
        const recipientUserId = `user-${randomUUID()}`;

        await dataSource.transaction(async (manager) => {
            const outbox = await appendNotificationIntent(manager, {
                id: eventId,
                eventType: "comment.created",
                eventVersion: 1,
                recipientUserId,
                actorUserId: "actor-1",
                payload: {
                    commentId: "c-1",
                    rootType: "review",
                    rootId: "r-1",
                },
            });

            expect(outbox.id).toBe(eventId);
            expect(outbox.state).toBe("pending");
            expect(outbox.attempts).toBe(0);
        });

        const found = await dataSource
            .getRepository(NotificationOutbox)
            .findOneBy({ id: eventId });
        expect(found).not.toBeNull();
        expect(found?.recipientUserId).toBe(recipientUserId);

        // cleanup
        await dataSource
            .getRepository(NotificationOutbox)
            .delete({ id: eventId });
    });

    it("rolls back caller's transaction if append fails", async () => {
        const eventId = `test-rollback-${randomUUID()}`;
        const markerId = `marker-${randomUUID()}`;

        // Create a test record inside a transaction, then inject an invalid append
        await expect(
            dataSource.transaction(async (manager) => {
                // save a valid outbox row as marker
                await appendNotificationIntent(manager, {
                    id: markerId,
                    eventType: "comment.created",
                    eventVersion: 1,
                    recipientUserId: "rec-1",
                    actorUserId: "act-1",
                    payload: {
                        commentId: "c-1",
                        rootType: "review",
                        rootId: "r-1",
                    },
                });

                // inject invalid append intent (unsupported version)
                await appendNotificationIntent(manager, {
                    id: eventId,
                    eventType: "comment.created",
                    eventVersion: 999, // unsupported
                    recipientUserId: "rec-1",
                    actorUserId: "act-1",
                    payload: {
                        commentId: "c-2",
                        rootType: "review",
                        rootId: "r-1",
                    },
                });
            }),
        ).rejects.toThrow(NotificationIntentValidationError);

        // Verify marker was rolled back and never committed
        const marker = await dataSource
            .getRepository(NotificationOutbox)
            .findOneBy({ id: markerId });
        expect(marker).toBeNull();

        const invalid = await dataSource
            .getRepository(NotificationOutbox)
            .findOneBy({ id: eventId });
        expect(invalid).toBeNull();
    });
});
