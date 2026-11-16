import "reflect-metadata";
import { DataSource, In } from "typeorm";
import { randomInt, randomUUID } from "node:crypto";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import {
    NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK,
    NotificationCampaignRequest,
    NotificationCampaignService,
} from "./notification-campaign.service";
import { NotificationOutbox } from "./entity/notification-outbox.entity";

describe("NotificationCampaignService (integration)", () => {
    const database = "notification_campaign_test";
    let cleanup: () => Promise<void>;
    let dataSource: DataSource;
    let campaigns: NotificationCampaignService;
    const created: string[] = [];
    const createdGames: number[] = [];
    const createdEvents: number[] = [];

    const outboxFor = (userIds: string[]) =>
        dataSource.getRepository(NotificationOutbox).find({
            where: { recipientUserId: In(userIds) },
            order: { id: "ASC" },
        });

    beforeAll(async () => {
        // Dedicated database: other notification suites wipe the shared one in parallel.
        const disposable = await createAwardsTestDatabase(database);
        cleanup = disposable.destroy;
        dataSource = disposable.source;
        campaigns = new NotificationCampaignService(dataSource);
        await dataSource.query(`CREATE TABLE IF NOT EXISTS \`user\` (
            \`id\` varchar(36) NOT NULL PRIMARY KEY,
            \`name\` varchar(255) NOT NULL,
            \`email\` varchar(255) NOT NULL UNIQUE,
            \`emailVerified\` boolean NOT NULL,
            \`image\` text,
            \`createdAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            \`updatedAt\` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
            \`role\` varchar(255) NOT NULL DEFAULT 'user',
            \`banned\` boolean,
            \`banReason\` text,
            \`banExpires\` timestamp(3) NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
        // Remove users left by a crashed run of this spec, so counts stay exact.
        const stale = await dataSource.query(
            "SELECT id FROM `user` WHERE email LIKE '%@campaign-test.local'",
        );
        await deleteRecipients(stale.map((row: { id: string }) => row.id));
        await dataSource.query(
            "DELETE FROM notification_campaign WHERE `key` LIKE 'it:%'",
        );
    });

    afterEach(async () => {
        await deleteRecipients(created.splice(0));
        const games = createdGames.splice(0);
        if (games.length > 0) {
            await dataSource.query("DELETE FROM game WHERE id IN (?)", [games]);
        }
        const events = createdEvents.splice(0);
        if (events.length > 0) {
            await dataSource.query(
                "DELETE FROM awards_category WHERE eventId IN (?)",
                [events],
            );
            await dataSource.query("DELETE FROM awards_event WHERE id IN (?)", [
                events,
            ]);
        }
    });

    afterAll(async () => {
        await cleanup?.();
    });

    async function deleteRecipients(userIds: string[]) {
        if (userIds.length === 0) return;
        await dataSource.query("DELETE FROM profile WHERE userId IN (?)", [
            userIds,
        ]);
        await dataSource.query("DELETE FROM library WHERE userId IN (?)", [
            userIds,
        ]);
        await dataSource.query("DELETE FROM `user` WHERE id IN (?)", [userIds]);
    }

    async function user(
        lockout: { banExpires: Date | null } | null = null,
    ): Promise<string> {
        const userId = randomUUID();
        await dataSource.query(
            "INSERT INTO `user` (id, name, email, emailVerified, banned, banExpires) VALUES (?, ?, ?, 1, ?, ?)",
            [
                userId,
                "Campaign fixture",
                `${userId}@campaign-test.local`,
                lockout ? 1 : 0,
                lockout?.banExpires ?? null,
            ],
        );
        await dataSource.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [userId, `u${userId.slice(0, 18)}`],
        );
        await dataSource.query("INSERT INTO library (userId) VALUES (?)", [
            userId,
        ]);
        created.push(userId);
        return userId;
    }

    async function game(): Promise<number> {
        const id = 8_000_000_000_000 + randomInt(0, 1_000_000_000);
        await dataSource.query(
            "INSERT INTO game (id, name, slug) VALUES (?, ?, ?)",
            [id, `Campaign game ${id}`, `campaign-game-${id}`],
        );
        createdGames.push(id);
        return id;
    }

    async function awardsEvent(categoryCount: number) {
        const year = 3000 + randomInt(0, 6000);
        const result = await dataSource.query(
            "INSERT INTO awards_event (year, votingStartDate, votingEndDate, resultsDate) VALUES (?, NOW(), NOW(), NOW())",
            [year],
        );
        const eventId = result.insertId as number;
        createdEvents.push(eventId);
        const categoryIds: number[] = [];
        for (let index = 0; index < categoryCount; index++) {
            const category = await dataSource.query(
                "INSERT INTO awards_category (eventId, name, description, `order`) VALUES (?, ?, ?, ?)",
                [eventId, `Category ${index}`, "Fixture", index],
            );
            categoryIds.push(category.insertId);
        }
        return { eventId, categoryIds };
    }

    async function campaign(
        request: NotificationCampaignRequest,
        options?: { batchSize?: number; maxBatches?: number },
    ) {
        return campaigns.runCampaign(request, options);
    }

    it("fans out once per recipient and sends nothing on a rerun", async () => {
        const users = await Promise.all([user(), user(), user()]);
        const request: NotificationCampaignRequest = {
            key: `it:${randomUUID()}`,
            eventType: "awards.milestone",
            payload: { eventId: 1, year: 2026, milestone: "voting_open" },
        };

        expect(await campaign(request)).toEqual({
            completed: true,
            sent: 3,
            batches: 2,
        });
        const rows = await outboxFor(users);
        expect(rows.map((row) => row.recipientUserId).sort()).toEqual(
            [...users].sort(),
        );
        expect(
            rows.every(
                (row) =>
                    row.eventType === "awards.milestone" &&
                    row.actorUserId === null &&
                    row.eventVersion === 1,
            ),
        ).toBe(true);

        expect(await campaign(request)).toEqual({
            completed: true,
            sent: 0,
            batches: 1,
        });
        expect(await outboxFor(users)).toHaveLength(3);
    });

    it("resumes an interrupted fan-out from the next batch", async () => {
        const users = await Promise.all(
            Array.from({ length: 100 }, () => user()),
        );
        const request: NotificationCampaignRequest = {
            key: `it:${randomUUID()}`,
            eventType: "awards.milestone",
            payload: {
                eventId: 1,
                year: 2026,
                milestone: "nominations_open",
            },
        };

        expect(
            await campaign(request, { batchSize: 10, maxBatches: 3 }),
        ).toEqual({ completed: false, sent: 30, batches: 3 });
        expect(await outboxFor(users)).toHaveLength(30);
        expect(
            await dataSource.query(
                "SELECT completedAt FROM notification_campaign WHERE `key` = ?",
                [request.key],
            ),
        ).toEqual([{ completedAt: null }]);

        expect(await campaign(request, { batchSize: 10 })).toEqual({
            completed: true,
            sent: 70,
            batches: 8,
        });
        const rows = await outboxFor(users);
        expect(rows).toHaveLength(100);
        expect(new Set(rows.map((row) => row.recipientUserId)).size).toBe(100);

        expect(await campaign(request, { batchSize: 10 })).toEqual({
            completed: true,
            sent: 0,
            batches: 1,
        });
    });

    it("excludes banned and suspended users", async () => {
        const allowed = await user();
        const expired = await user({
            banExpires: new Date(Date.now() - 60_000),
        });
        const banned = await user({ banExpires: null });
        const suspended = await user({
            banExpires: new Date(Date.now() + 60_000),
        });

        expect(
            await campaign({
                key: `it:${randomUUID()}`,
                eventType: "awards.milestone",
                payload: {
                    eventId: 1,
                    year: 2026,
                    milestone: "voting_open",
                },
            }),
        ).toEqual({ completed: true, sent: 2, batches: 2 });
        expect(
            (await outboxFor([allowed, expired, banned, suspended])).map(
                (row) => row.recipientUserId,
            ),
        ).toEqual(expect.arrayContaining([allowed, expired]));
        expect(await outboxFor([banned, suspended])).toHaveLength(0);
    });

    it("skips users who already nominated for the nominations reminder", async () => {
        const { eventId, categoryIds } = await awardsEvent(1);
        const nominator = await user();
        const other = await user();
        await dataSource.query(
            "INSERT INTO awards_nomination (categoryId, gameId, profileUserId) VALUES (?, ?, ?)",
            [categoryIds[0], await game(), nominator],
        );

        expect(
            await campaign({
                key: `it:${randomUUID()}`,
                eventType: "awards.milestone",
                payload: {
                    eventId,
                    year: 2026,
                    milestone: "nominations_close_reminder",
                },
            }),
        ).toEqual({ completed: true, sent: 1, batches: 2 });
        expect(await outboxFor([nominator])).toHaveLength(0);
        expect(await outboxFor([other])).toHaveLength(1);
    });

    it("skips complete ballots for the voting reminder", async () => {
        const { eventId, categoryIds } = await awardsEvent(2);
        const complete = await user();
        const partial = await user();
        const absent = await user();
        for (const categoryId of categoryIds) {
            await dataSource.query(
                "INSERT INTO awards_vote (categoryId, gameId, profileUserId) VALUES (?, ?, ?)",
                [categoryId, await game(), complete],
            );
        }
        await dataSource.query(
            "INSERT INTO awards_vote (categoryId, gameId, profileUserId) VALUES (?, ?, ?)",
            [categoryIds[0], await game(), partial],
        );

        expect(
            await campaign({
                key: `it:${randomUUID()}`,
                eventType: "awards.milestone",
                payload: {
                    eventId,
                    year: 2026,
                    milestone: "voting_close_reminder",
                },
            }),
        ).toEqual({ completed: true, sent: 2, batches: 2 });
        expect(await outboxFor([complete])).toHaveLength(0);
        expect(
            (await outboxFor([partial, absent])).map(
                (row) => row.recipientUserId,
            ),
        ).toEqual(expect.arrayContaining([partial, absent]));
    });

    it("stops at the 20-batch limit per tick and resumes on the next", async () => {
        const users = await Promise.all(
            Array.from({ length: 45 }, () => user()),
        );
        const request: NotificationCampaignRequest = {
            key: `it:${randomUUID()}`,
            eventType: "awards.milestone",
            payload: { eventId: 1, year: 2026, milestone: "results_published" },
        };

        expect(NOTIFICATION_CAMPAIGN_MAX_BATCHES_PER_TICK).toBe(20);
        expect(await campaign(request, { batchSize: 2 })).toEqual({
            completed: false,
            sent: 40,
            batches: 20,
        });
        expect(await campaign(request, { batchSize: 2 })).toEqual({
            completed: true,
            sent: 5,
            batches: 4,
        });
        expect(await outboxFor(users)).toHaveLength(45);
        await expect(
            campaigns.runCampaign(request, { maxBatches: 21 }),
        ).rejects.toThrow(RangeError);
    });

    it("sends each user's goal target and progress once", async () => {
        const ahead = await user();
        const behind = await user();
        const withoutGoal = await user();
        await dataSource.query(
            "INSERT INTO year_goal (profileUserId, year, finishedGamesTarget, createdAt, updatedAt) VALUES (?, 2027, ?, NOW(6), NOW(6))",
            [ahead, 18],
        );
        await dataSource.query(
            "INSERT INTO year_goal (profileUserId, year, finishedGamesTarget, createdAt, updatedAt) VALUES (?, 2027, ?, NOW(6), NOW(6))",
            [behind, 5],
        );
        for (let index = 0; index < 7; index++) {
            await dataSource.query(
                "INSERT INTO collection_entry (id, gameId, libraryUserId, finishedAt) VALUES (?, ?, ?, ?)",
                [
                    randomUUID(),
                    await game(),
                    ahead,
                    new Date(Date.UTC(2027, 2, 1 + index)),
                ],
            );
        }
        await dataSource.query(
            "INSERT INTO collection_entry (id, gameId, libraryUserId, finishedAt) VALUES (?, ?, ?, ?)",
            [
                randomUUID(),
                await game(),
                behind,
                new Date(Date.UTC(2026, 5, 1)),
            ],
        );

        const request: NotificationCampaignRequest = {
            key: `it:${randomUUID()}`,
            eventType: "goal.reminder",
            payload: { year: 2027 },
        };
        expect(await campaign(request)).toEqual({
            completed: true,
            sent: 2,
            batches: 2,
        });

        const rows = await outboxFor([ahead, behind, withoutGoal]);
        expect(
            Object.fromEntries(
                rows.map((row) => [row.recipientUserId, row.payload]),
            ),
        ).toEqual({
            [ahead]: { year: 2027, target: 18, finished: 7 },
            [behind]: { year: 2027, target: 5, finished: 0 },
        });
        expect(rows.every((row) => row.actorUserId === null)).toBe(true);

        expect(await campaign(request)).toEqual({
            completed: true,
            sent: 0,
            batches: 1,
        });
    });

    it("rejects an invalid campaign key or payload", async () => {
        await expect(
            campaigns.runCampaign({
                key: "",
                eventType: "awards.milestone",
                payload: { eventId: 1, year: 2026, milestone: "voting_open" },
            }),
        ).rejects.toThrow(RangeError);
        await expect(
            campaigns.runCampaign({
                key: `it:${randomUUID()}`,
                eventType: "awards.milestone",
                payload: { eventId: 1, year: 2026, milestone: "nope" as any },
            }),
        ).rejects.toThrow(RangeError);
    });
});
