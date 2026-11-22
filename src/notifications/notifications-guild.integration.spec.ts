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
import { NotificationEvent } from "./entity/notification-event.entity";
import { NotificationInbox } from "./entity/notification-inbox.entity";
import { Profile } from "../profile/entities/profile.entity";
import {
    appendNotificationIntent,
    validateNotificationIntent,
} from "./notifications-outbox.service";
import {
    GuildContractReadyPayload,
    NotificationEventIntent,
} from "./notifications.types";

describe("guild.contract-ready notifications (integration)", () => {
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

    function guildPayload(
        contractId: string,
        overrides: Partial<GuildContractReadyPayload> = {},
    ): GuildContractReadyPayload {
        return {
            contractId,
            category: "library",
            templateKey: "forgotten_relic",
            eventId: null,
            targetGameId: null,
            ...overrides,
        };
    }

    function intent(
        payload: GuildContractReadyPayload,
        overrides: Record<string, unknown> = {},
    ): NotificationEventIntent {
        return {
            eventType: "guild.contract-ready",
            eventVersion: 1,
            recipientUserId: randomUUID(),
            actorUserId: null,
            payload,
            ...overrides,
        } as NotificationEventIntent;
    }

    async function deliver(
        recipientUserId: string,
        contractId: string,
        overrides: Partial<GuildContractReadyPayload> = {},
    ) {
        const repo = dataSource.getRepository(NotificationOutbox);
        const id = randomUUID();
        const token = randomUUID();
        await repo.save({
            id,
            eventType: "guild.contract-ready",
            eventVersion: 1,
            occurredAt: new Date(),
            recipientUserId,
            actorUserId: null,
            payload: guildPayload(contractId, overrides),
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
        notifications.findAll(userId, { limit: 10 } as any);

    it("commits the intent inside the calling transaction", async () => {
        const userId = await recipient();
        const contractId = randomUUID();

        await dataSource.transaction(async (manager) => {
            await appendNotificationIntent(
                manager,
                intent(guildPayload(contractId), { recipientUserId: userId }),
            );
        });

        const rows = await dataSource
            .getRepository(NotificationOutbox)
            .findBy({ recipientUserId: userId });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            eventType: "guild.contract-ready",
            eventVersion: 1,
            actorUserId: null,
            state: "pending",
            payload: guildPayload(contractId),
        });
    });

    it("materializes one individual inbox item with a safe preview and guild destination", async () => {
        const userId = await recipient();
        const contractId = randomUUID();
        await deliver(userId, contractId, { targetGameId: 1 });

        const { data, unreadCount } = await inboxOf(userId);
        expect(unreadCount).toBe(1);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
            type: "guild.contract-ready",
            target: { type: "guild", contractId },
            preview: {
                text: "A Guild contract is ready to turn in.",
                game: {
                    id: 1,
                    name: "Notification fixture",
                    slug: "notification-fixture",
                    coverUrl: null,
                },
            },
            eventCount: 1,
            actorCount: 0,
            actors: [],
        });

        const inbox = await dataSource
            .getRepository(NotificationInbox)
            .findOneByOrFail({ recipientUserId: userId });
        expect(inbox).toMatchObject({
            subjectType: "guild_contract",
            subjectId: contractId,
            rootType: "guild",
            rootId: contractId,
        });
    });

    it("omits the game context when the contract has no target game", async () => {
        const userId = await recipient();
        await deliver(userId, randomUUID(), { targetGameId: null });

        const { data } = await inboxOf(userId);
        expect(data[0].preview).toEqual({
            text: "A Guild contract is ready to turn in.",
        });
    });

    it("does not duplicate the inbox item when the same delivery is retried", async () => {
        const userId = await recipient();
        const contractId = randomUUID();
        const outboxId = await deliver(userId, contractId);

        const retryToken = randomUUID();
        await dataSource.getRepository(NotificationOutbox).update(
            { id: outboxId },
            {
                state: "processing",
                ownerToken: retryToken,
                ownerExpiresAt: new Date(Date.now() + 30_000),
            },
        );
        expect(await projector.projectEvent(outboxId, retryToken)).toBe(true);

        const { data, unreadCount } = await inboxOf(userId);
        expect(data).toHaveLength(1);
        expect(unreadCount).toBe(1);
        expect(data[0]).toMatchObject({
            target: { type: "guild", contractId },
            eventCount: 1,
            version: 1,
        });
        expect(
            await dataSource
                .getRepository(NotificationEvent)
                .countBy({ eventId: outboxId }),
        ).toBe(1);
    });

    it("accepts a valid payload with nullable optional context", () => {
        expect(() =>
            validateNotificationIntent(intent(guildPayload(randomUUID()))),
        ).not.toThrow();
    });

    it.each([
        ["a missing recipient", { recipientUserId: null }],
        ["a system actor supplied", { actorUserId: randomUUID() }],
    ])("rejects %s", (_label, overrides) => {
        expect(() =>
            validateNotificationIntent(
                intent(guildPayload(randomUUID()), overrides),
            ),
        ).toThrow();
    });

    it.each([
        ["an empty contractId", { contractId: "" }],
        ["an empty category", { category: "" }],
        ["a numeric contractId", { contractId: 7 }],
        ["a numeric templateKey", { templateKey: 7 }],
        ["a missing templateKey", { templateKey: undefined }],
        ["a numeric eventId", { eventId: 7 }],
        ["a missing eventId", { eventId: undefined }],
        ["a zero targetGameId", { targetGameId: 0 }],
        ["a fractional targetGameId", { targetGameId: 1.5 }],
        ["a numeric string targetGameId", { targetGameId: "1" }],
        ["a missing targetGameId", { targetGameId: undefined }],
        ["an extra field", { extra: true }],
    ])("rejects %s", (_label, overrides) => {
        expect(() =>
            validateNotificationIntent(
                intent({
                    ...guildPayload(randomUUID()),
                    ...overrides,
                } as GuildContractReadyPayload),
            ),
        ).toThrow();
    });
});
