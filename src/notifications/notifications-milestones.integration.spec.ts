import "reflect-metadata";
import { DataSource } from "typeorm";
import { randomUUID } from "node:crypto";
import {
    createLibraryAccessService,
    createNotificationTestDataSource,
} from "../../test/notifications/notification-test-harness";
import { NotificationsProjectorService } from "./notifications-projector.service";
import { NotificationsRelayService } from "./notifications-relay.service";
import { NotificationsService } from "./notifications.service";
import { NotificationOutbox } from "./entity/notification-outbox.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { Profile } from "../profile/entities/profile.entity";
import { validateNotificationIntent } from "./notifications-outbox.service";
import {
    AWARDS_MILESTONES,
    NotificationEventIntent,
} from "./notifications.types";

describe("Awards, Recap and goal notifications (integration)", () => {
    let dataSource: DataSource;
    let projector: NotificationsProjectorService;
    let notifications: NotificationsService;

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        projector = new NotificationsProjectorService(
            dataSource,
            new NotificationsRelayService(
                dataSource,
                dataSource.getRepository(NotificationOutbox),
                { add: jest.fn() } as any,
            ),
            createLibraryAccessService(dataSource),
        );
        notifications = new NotificationsService(
            dataSource.getRepository(NotificationInbox),
            dataSource.getRepository(Profile),
            dataSource,
        );
    });

    afterAll(() => dataSource?.destroy());

    async function recipient() {
        const userId = randomUUID();
        await dataSource.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [userId, `u${userId.slice(0, 18)}`],
        );
        return userId;
    }

    async function deliver(
        eventType: NotificationEventIntent["eventType"],
        payload: Record<string, unknown>,
        recipientUserId: string | null,
    ) {
        const repo = dataSource.getRepository(NotificationOutbox);
        const id = randomUUID();
        const token = randomUUID();
        await repo.save({
            id,
            eventType,
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId,
            actorUserId: null,
            payload,
            state: "processing",
            ownerToken: token,
            ownerExpiresAt: new Date(Date.now() + 30_000),
            attempts: 1,
            nextAttemptAt: new Date(),
        });
        expect(await projector.projectEvent(id, token)).toBe(true);
        return id;
    }

    const inboxOf = (userId: string) =>
        notifications.findAll(userId, { limit: 10 });

    it.each([
        ["nominations_open", "nominations"],
        ["nominations_close_reminder", "nominations"],
        ["voting_open", "voting"],
        ["voting_close_reminder", "voting"],
        ["results_published", "results"],
    ] as const)(
        "renders the %s Awards milestone as an awards destination in %s",
        async (milestone, phase) => {
            const userId = await recipient();
            await deliver(
                "awards.milestone",
                { eventId: 7, year: 2026, milestone },
                userId,
            );

            const { data } = await inboxOf(userId);
            expect(data).toHaveLength(1);
            expect(data[0].type).toBe("awards.milestone");
            expect(data[0].target).toEqual({
                type: "awards",
                eventId: 7,
                year: 2026,
                phase,
            });
            expect(data[0].preview?.text).toEqual(expect.any(String));
            expect(data[0].preview?.milestone).toBe(milestone);
            expect(data[0].actors).toEqual([]);
        },
    );

    it.each(["available", "closed"] as const)(
        "renders the %s Recap milestone as the recipient's recap destination",
        async (milestone) => {
            const userId = await recipient();
            await deliver("recap.milestone", { year: 2026, milestone }, userId);

            const { data } = await inboxOf(userId);
            expect(data).toHaveLength(1);
            expect(data[0].target).toEqual({
                type: "recap",
                userId,
                year: 2026,
            });
            expect(data[0].preview?.text).toEqual(expect.any(String));
            expect(data[0].preview?.milestone).toBe(milestone);
            expect(data[0].actors).toEqual([]);
        },
    );

    it("renders the goal reminder with its target and progress", async () => {
        const userId = await recipient();
        await deliver(
            "goal.reminder",
            { year: 2027, target: 18, finished: 7 },
            userId,
        );

        const { data } = await inboxOf(userId);
        expect(data).toHaveLength(1);
        expect(data[0].target).toEqual({ type: "goal", year: 2027 });
        expect(data[0].preview).toMatchObject({ target: 18, finished: 7 });
        expect(data[0].actors).toEqual([]);
    });

    it("delivers all three destinations in a single inbox read", async () => {
        const userId = await recipient();
        await deliver(
            "awards.milestone",
            { eventId: 9, year: 2026, milestone: "results_published" },
            userId,
        );
        await deliver(
            "recap.milestone",
            { year: 2026, milestone: "closed" },
            userId,
        );
        await deliver(
            "goal.reminder",
            { year: 2027, target: 12, finished: 3 },
            userId,
        );

        const { data, unreadCount } = await inboxOf(userId);
        expect(unreadCount).toBe(3);
        expect(
            data.map((item) => (item.target as { type: string }).type).sort(),
        ).toEqual(["awards", "goal", "recap"]);
        expect(data.every((item) => item.actors.length === 0)).toBe(true);
    });

    it("suppresses system milestones without a recipient", async () => {
        await deliver(
            "awards.milestone",
            { eventId: 987654, year: 2026, milestone: "voting_open" },
            null,
        );
        expect(
            await dataSource.getRepository(NotificationInbox).countBy({
                subjectType: "awards",
                subjectId: "987654",
            }),
        ).toBe(0);
    });

    it.each([
        ["awards.milestone", { eventId: 1, year: 2026, milestone: "nope" }],
        [
            "awards.milestone",
            { eventId: 0, year: 2026, milestone: "voting_open" },
        ],
        [
            "awards.milestone",
            {
                eventId: 1,
                year: 2026,
                milestone: "voting_open",
                phase: "voting",
            },
        ],
        ["recap.milestone", { year: 2026, milestone: "final" }],
        ["goal.reminder", { year: 2027, target: 0, finished: 0 }],
        ["goal.reminder", { year: 2027, target: 4, finished: -1 }],
        ["goal.reminder", { year: 2027, target: 4 }],
    ])("rejects an invalid %s payload: %j", (eventType, payload) => {
        expect(() =>
            validateNotificationIntent({
                eventType,
                eventVersion: 1,
                recipientUserId: randomUUID(),
                actorUserId: null,
                payload,
            } as NotificationEventIntent),
        ).toThrow();
    });

    it("accepts every supported Awards milestone payload", () => {
        for (const milestone of AWARDS_MILESTONES) {
            expect(() =>
                validateNotificationIntent({
                    eventType: "awards.milestone",
                    eventVersion: 1,
                    recipientUserId: randomUUID(),
                    actorUserId: null,
                    payload: { eventId: 1, year: 2026, milestone },
                } as NotificationEventIntent),
            ).not.toThrow();
        }
    });
});
