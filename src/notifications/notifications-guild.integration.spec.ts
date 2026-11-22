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
    GuildContractExpiringPayload,
    NotificationEventIntent,
} from "./notifications.types";
import { GuildContractRemindersService } from "../guild/guild-contract-reminders.service";
import { GuildContractStatus } from "../guild/guild.constants";

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

describe("guild.contract-expiring notifications (integration)", () => {
    const NOW = new Date("2026-06-17T12:00:00Z");
    const DAY_MS = 24 * 60 * 60 * 1000;
    let dataSource: DataSource;
    let projector: NotificationsProjectorService;
    let notifications: NotificationsService;
    let reminders: GuildContractRemindersService;

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
        reminders = new GuildContractRemindersService(dataSource);
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

    async function contract(
        userId: string,
        values: {
            status?: GuildContractStatus;
            expiresAt?: Date | null;
            targetGameId?: number | null;
        } = {},
    ) {
        const id = randomUUID();
        await dataSource.query(
            `INSERT INTO guild_contract
                (id, profileUserId, category, templateKey, \`rank\`, xpReward,
                 objectiveType, criteria, targetGameId, progressCurrent, progressTarget,
                 status, acceptedAt, expiresAt)
             VALUES (?, ?, 'weekly', 'weekend_sprint', 'D', 140, 'finish_game', '{}', ?, 0, 1, ?, ?, ?)`,
            [
                id,
                userId,
                values.targetGameId ?? null,
                values.status ?? GuildContractStatus.ACTIVE,
                new Date(NOW.getTime() - DAY_MS),
                values.expiresAt === undefined
                    ? new Date(NOW.getTime() + 2 * 60 * 60 * 1000)
                    : values.expiresAt,
            ],
        );
        return id;
    }

    async function expiringIntents(contractId: string) {
        const rows: Array<{ payload: unknown }> = await dataSource.query(
            "SELECT payload FROM notification_outbox WHERE eventType = ?",
            ["guild.contract-expiring"],
        );
        return rows.filter((row) => {
            const payload =
                typeof row.payload === "string"
                    ? JSON.parse(row.payload)
                    : (row.payload as Record<string, unknown>);
            return payload?.contractId === contractId;
        });
    }

    function expiringPayload(
        contractId: string,
        overrides: Partial<GuildContractExpiringPayload> = {},
    ): GuildContractExpiringPayload {
        return {
            contractId,
            category: "weekly",
            templateKey: "weekend_sprint",
            eventId: null,
            targetGameId: null,
            expiresAt: "2026-06-18T10:00:00.000Z",
            ...overrides,
        };
    }

    function intent(
        payload: GuildContractExpiringPayload,
        overrides: Record<string, unknown> = {},
    ): NotificationEventIntent {
        return {
            eventType: "guild.contract-expiring",
            eventVersion: 1,
            recipientUserId: randomUUID(),
            actorUserId: null,
            payload,
            ...overrides,
        } as NotificationEventIntent;
    }

    it("queues a single reminder per contract even when the tick runs twice", async () => {
        const userId = await recipient();
        const contractId = await contract(userId);

        expect(await reminders.notifyExpiring(NOW)).toBe(1);
        expect(await reminders.notifyExpiring(NOW)).toBe(0);

        const intents = await expiringIntents(contractId);
        expect(intents).toHaveLength(1);
        expect(intents[0].payload).toEqual({
            contractId,
            category: "weekly",
            templateKey: "weekend_sprint",
            eventId: null,
            targetGameId: null,
            expiresAt: new Date(
                NOW.getTime() + 2 * 60 * 60 * 1000,
            ).toISOString(),
        });

        const [stored] = await dataSource.query(
            "SELECT expiringNotifiedAt FROM guild_contract WHERE id = ?",
            [contractId],
        );
        expect(new Date(stored.expiringNotifiedAt).getTime()).toBe(
            NOW.getTime(),
        );
    });

    it.each([
        ["ready to claim", GuildContractStatus.READY_TO_CLAIM],
        ["completed", GuildContractStatus.COMPLETED],
        ["expired", GuildContractStatus.EXPIRED],
        ["abandoned", GuildContractStatus.ABANDONED],
    ])("does not remind %s contracts", async (_label, status) => {
        const userId = await recipient();
        const contractId = await contract(userId, { status });

        expect(await reminders.notifyExpiring(NOW)).toBe(0);
        expect(await expiringIntents(contractId)).toHaveLength(0);
    });

    it("does not remind contracts expiring beyond the next 24 hours", async () => {
        const userId = await recipient();
        const contractId = await contract(userId, {
            expiresAt: new Date(NOW.getTime() + DAY_MS + 60_000),
        });

        expect(await reminders.notifyExpiring(NOW)).toBe(0);
        expect(await expiringIntents(contractId)).toHaveLength(0);
    });

    it("does not remind contracts that already expired", async () => {
        const userId = await recipient();
        const contractId = await contract(userId, {
            expiresAt: new Date(NOW.getTime() - 60_000),
        });

        expect(await reminders.notifyExpiring(NOW)).toBe(0);
        expect(await expiringIntents(contractId)).toHaveLength(0);
    });

    it("materializes an individual inbox item with the guild target", async () => {
        const userId = await recipient();
        const contractId = await contract(userId, { targetGameId: 1 });
        expect(await reminders.notifyExpiring(NOW)).toBe(1);

        const outbox = await dataSource
            .getRepository(NotificationOutbox)
            .findOneByOrFail({
                recipientUserId: userId,
                eventType: "guild.contract-expiring",
            });
        const token = randomUUID();
        await dataSource.getRepository(NotificationOutbox).update(
            { id: outbox.id },
            {
                state: "processing",
                ownerToken: token,
                ownerExpiresAt: new Date(Date.now() + 30_000),
            },
        );
        expect(await projector.projectEvent(outbox.id, token)).toBe(true);

        const { data, unreadCount } = await notifications.findAll(userId, {
            limit: 10,
        } as any);
        expect(unreadCount).toBe(1);
        expect(data).toHaveLength(1);
        expect(data[0]).toMatchObject({
            type: "guild.contract-expiring",
            target: { type: "guild", contractId },
            preview: {
                text: "A Guild contract expires in less than 24 hours.",
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

    it("accepts a valid payload with nullable optional context", () => {
        expect(() =>
            validateNotificationIntent(intent(expiringPayload(randomUUID()))),
        ).not.toThrow();
    });

    it.each([
        ["a missing recipient", { recipientUserId: null }],
        ["a system actor supplied", { actorUserId: randomUUID() }],
    ])("rejects %s", (_label, overrides) => {
        expect(() =>
            validateNotificationIntent(
                intent(expiringPayload(randomUUID()), overrides),
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
        ["an invalid expiresAt", { expiresAt: "not-a-date" }],
        ["a numeric expiresAt", { expiresAt: 123 }],
        ["a missing expiresAt", { expiresAt: undefined }],
        ["an extra field", { extra: true }],
    ])("rejects %s", (_label, overrides) => {
        expect(() =>
            validateNotificationIntent(
                intent({
                    ...expiringPayload(randomUUID()),
                    ...overrides,
                } as GuildContractExpiringPayload),
            ),
        ).toThrow();
    });
});
