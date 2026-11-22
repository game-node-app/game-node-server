import "reflect-metadata";
import { randomUUID } from "node:crypto";
import {
    INestApplication,
    ValidationPipe,
    VersioningType,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { DataSource } from "typeorm";
import request from "supertest";
import { createAwardsTestDatabase } from "../../test/awards/awards-test-database";
import {
    AchievementCategory,
    AchievementStatus,
} from "../achievements/achievements.constants";
import { AchievementDefinition } from "../achievements/entities/achievement-definition.entity";
import { AuthService } from "../auth/auth.service";
import { GuildAdminController } from "./guild-admin.controller";
import { GuildAdminService } from "./guild-admin.service";
import { GuildEvent } from "./entities/guild-event.entity";
import { GuildReward } from "./entities/guild-reward.entity";

const DATABASE = `guild_admin_test_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
const ACCOUNTS = {
    admin: { id: "00000000-0000-0000-0000-0000000000a1", role: "user,admin" },
    editor: { id: "00000000-0000-0000-0000-0000000000a2", role: "user,editor" },
    reader: { id: "00000000-0000-0000-0000-0000000000a3", role: "user" },
};
const READER_ID = ACCOUNTS.reader.id;

const EN = {
    locale: "en",
    title: "Metroidvania Month",
    description: "Finish a metroidvania.",
};
const PT_BR = {
    locale: "pt-BR",
    title: "Mês da Metroidvania",
    description: "Zere um metroidvania.",
};

jest.setTimeout(120000);

describe("Guild admin catalog (integration)", () => {
    let db: Awaited<ReturnType<typeof createAwardsTestDatabase>> | undefined;
    let source: DataSource;
    let app: INestApplication;

    const server = () => app.getHttpServer();
    const as = (token: keyof typeof ACCOUNTS) => `Bearer ${token}`;

    const eventPayload = (overrides: Record<string, unknown> = {}) => ({
        slug: `event-${randomUUID().slice(0, 8)}`,
        title: "Metroidvania Month",
        description: "Finish a metroidvania.",
        rank: "A",
        xpReward: 400,
        objectiveType: "finish_game",
        targetCount: 1,
        criteria: { genreIds: [8] },
        startsAt: "2099-01-01T00:00:00.000Z",
        endsAt: "2099-12-31T00:00:00.000Z",
        ...overrides,
    });

    const rewardPayload = (overrides: Record<string, unknown> = {}) => ({
        key: `frame_${randomUUID().slice(0, 8)}`,
        kind: "avatar_frame",
        inChestPool: false,
        ...overrides,
    });

    const postEvent = (
        body: Record<string, unknown>,
        token: keyof typeof ACCOUNTS = "editor",
    ) =>
        request(server())
            .post("/v1/guild/admin/events")
            .set("Authorization", as(token))
            .send(body);

    const patchEvent = (id: string, body: Record<string, unknown>) =>
        request(server())
            .patch(`/v1/guild/admin/events/${id}`)
            .set("Authorization", as("editor"))
            .send(body);

    const postReward = (body: Record<string, unknown>) =>
        request(server())
            .post("/v1/guild/admin/rewards")
            .set("Authorization", as("editor"))
            .send(body);

    const patchReward = (id: string, body: Record<string, unknown>) =>
        request(server())
            .patch(`/v1/guild/admin/rewards/${id}`)
            .set("Authorization", as("editor"))
            .send(body);

    const publishEventRequest = (id: string) =>
        request(server())
            .post(`/v1/guild/admin/events/${id}/publish`)
            .set("Authorization", as("editor"));

    const createEvent = async (overrides: Record<string, unknown> = {}) => {
        const response = await postEvent(eventPayload(overrides)).expect(201);
        return response.body;
    };

    const createReward = async (overrides: Record<string, unknown> = {}) => {
        const response = await postReward(rewardPayload(overrides)).expect(201);
        return response.body;
    };

    const createContract = async (
        eventId: string,
        status = "active",
        expiresAt: Date | null = null,
    ) => {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_contract
                (id, profileUserId, eventId, category, \`rank\`, xpReward, objectiveType, criteria, status, acceptedAt, expiresAt)
             VALUES (?, ?, ?, 'event', 'A', 400, 'finish_game', '{}', ?, NOW(6), ?)`,
            [id, READER_ID, eventId, status, expiresAt],
        );
        return id;
    };

    beforeAll(async () => {
        db = await createAwardsTestDatabase(DATABASE);
        source = db.source;

        const definitions = source.getRepository(AchievementDefinition);
        await definitions.insert({
            id: "guild-archaeologist",
            name: "Guild Archaeologist",
            description: "Finish a forgotten relic.",
            category: AchievementCategory.COLLECTIONS,
            metric: "manual",
            criteria: {},
            icon: { kind: "glyph", name: "relic" },
            isHidden: false,
            status: AchievementStatus.PUBLISHED,
        });
        await definitions.insert({
            id: "guild-draft-badge",
            name: "Draft badge",
            description: "Not published yet.",
            category: AchievementCategory.MISC,
            metric: "manual",
            criteria: {},
            icon: { kind: "glyph", name: "draft" },
            isHidden: false,
            status: AchievementStatus.DRAFT,
        });
        await definitions.insert([
            {
                id: "guild-admin-draft-badge",
                name: "Admin draft badge",
                description: "Still a draft for the admin spec.",
                category: AchievementCategory.MISC,
                metric: "manual",
                criteria: {},
                icon: { kind: "glyph", name: "draft" },
                isHidden: false,
                status: AchievementStatus.DRAFT,
            },
            {
                id: "guild-admin-published-badge",
                name: "Admin published badge",
                description: "Published for the admin spec.",
                category: AchievementCategory.MISC,
                metric: "manual",
                criteria: {},
                icon: { kind: "glyph", name: "relic" },
                isHidden: false,
                status: AchievementStatus.PUBLISHED,
            },
        ]);
        await source.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [READER_ID, "guild_admin_reader"],
        );

        const moduleRef = await Test.createTestingModule({
            controllers: [GuildAdminController],
            providers: [
                GuildAdminService,
                {
                    provide: getRepositoryToken(GuildEvent),
                    useValue: source.getRepository(GuildEvent),
                },
                {
                    provide: getRepositoryToken(GuildReward),
                    useValue: source.getRepository(GuildReward),
                },
                {
                    provide: getRepositoryToken(AchievementDefinition),
                    useValue: definitions,
                },
                { provide: DataSource, useValue: source },
                {
                    provide: AuthService,
                    useValue: {
                        getSession: async (req: {
                            headers: { authorization?: string };
                        }) => {
                            const token = (
                                req.headers.authorization ?? ""
                            ).replace(/^Bearer /, "");
                            const user =
                                ACCOUNTS[token as keyof typeof ACCOUNTS];
                            return user ? { user } : null;
                        },
                    },
                },
            ],
        }).compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({
            type: VersioningType.URI,
            defaultVersion: "1",
        });
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                transformOptions: { enableImplicitConversion: true },
            }),
        );
        await app.init();
    });

    afterAll(async () => {
        if (app) await app.close();
        await db?.destroy();
    });

    describe("access control", () => {
        it("requires authentication on every catalog route", async () => {
            await request(server()).get("/v1/guild/admin/events").expect(401);
            await request(server()).get("/v1/guild/admin/rewards").expect(401);
            await request(server())
                .post("/v1/guild/admin/events")
                .send(eventPayload())
                .expect(401);
        });

        it("forbids regular users", async () => {
            await request(server())
                .get("/v1/guild/admin/events")
                .set("Authorization", as("reader"))
                .expect(403);
            await request(server())
                .post("/v1/guild/admin/rewards")
                .set("Authorization", as("reader"))
                .send(rewardPayload())
                .expect(403);
        });

        it("allows admins and editors to read", async () => {
            await request(server())
                .get("/v1/guild/admin/events")
                .set("Authorization", as("admin"))
                .expect(200);
            await request(server())
                .get("/v1/guild/admin/rewards")
                .set("Authorization", as("editor"))
                .expect(200);
        });
    });

    describe("rewards", () => {
        it("creates badge and cosmetic rewards", async () => {
            const badge = await createReward({
                key: "badge_archaeologist_admin",
                kind: "badge",
                achievementId: "guild-archaeologist",
            });
            expect(badge).toMatchObject({
                key: "badge_archaeologist_admin",
                kind: "badge",
                achievementId: "guild-archaeologist",
                inChestPool: false,
                chestBonusXp: 0,
                isActive: true,
            });

            const frame = await createReward({
                key: "frame_metroidvania_2026",
                kind: "avatar_frame",
                chestBonusXp: 10,
            });
            expect(frame).toMatchObject({
                kind: "avatar_frame",
                chestBonusXp: 10,
            });
        });

        it("rejects a duplicate key with 409", async () => {
            await postReward({
                key: "frame_metroidvania_2026",
                kind: "title",
            }).expect(409);
        });

        it.each([
            ["a badge without achievementId", { kind: "badge" }],
            [
                "a badge with an unknown achievement",
                { kind: "badge", achievementId: "missing-achievement" },
            ],
            [
                "a badge in the chest pool",
                {
                    kind: "badge",
                    achievementId: "guild-archaeologist",
                    inChestPool: true,
                },
            ],
            [
                "a weekly chest in the chest pool",
                { kind: "weekly_chest", inChestPool: true },
            ],
            ["an unknown kind", { kind: "trophy" }],
        ])("rejects %s with 400", async (label, overrides) => {
            await postReward({
                key: `invalid_${randomUUID().slice(0, 8)}`,
                ...overrides,
            }).expect(400);
        });

        it("toggles isActive and blocks inactive rewards on events", async () => {
            const reward = await createReward({ kind: "title" });
            await request(server())
                .patch(`/v1/guild/admin/rewards/${reward.id}`)
                .set("Authorization", as("editor"))
                .send({ isActive: false })
                .expect(200)
                .expect(({ body }) => expect(body.isActive).toBe(false));

            await postEvent(eventPayload({ rewardId: reward.id })).expect(400);

            await request(server())
                .patch(`/v1/guild/admin/rewards/${reward.id}`)
                .set("Authorization", as("editor"))
                .send({ isActive: true })
                .expect(200)
                .expect(({ body }) => expect(body.isActive).toBe(true));
        });
    });

    describe("events", () => {
        it("creates a draft event with translations and an active reward", async () => {
            const frame = await createReward({
                key: `frame_reward_${randomUUID().slice(0, 8)}`,
            });
            const event = await createEvent({
                translations: [EN, PT_BR],
                rewardId: frame.id,
            });

            expect(event).toMatchObject({
                status: "draft",
                title: "Metroidvania Month",
                rank: "A",
                xpReward: 400,
                objectiveType: "finish_game",
                targetCount: 1,
                publishedAt: null,
                reward: {
                    id: frame.id,
                    key: frame.key,
                    kind: "avatar_frame",
                },
            });
            expect(event.translations).toEqual([EN, PT_BR]);

            const listed = await request(server())
                .get("/v1/guild/admin/events")
                .set("Authorization", as("editor"))
                .expect(200);
            expect(
                listed.body.find(({ id }: { id: string }) => id === event.id),
            ).toMatchObject({ slug: event.slug });

            await request(server())
                .get(`/v1/guild/admin/events/${event.id}`)
                .set("Authorization", as("editor"))
                .expect(200)
                .expect(({ body }) =>
                    expect(body.translations).toEqual([EN, PT_BR]),
                );
        });

        it("defaults targetCount and returns [] when translations are omitted", async () => {
            const event = await createEvent({ targetCount: undefined });
            expect(event.targetCount).toBe(1);
            expect(event.translations).toEqual([]);
        });

        it("rejects a duplicate slug with 409", async () => {
            const event = await createEvent();
            await postEvent(eventPayload({ slug: event.slug })).expect(409);

            const other = await createEvent();
            await patchEvent(event.id, { slug: other.slug }).expect(409);
        });

        it.each([
            ["an inverted window", { endsAt: "2098-11-30T00:00:00.000Z" }],
            [
                "a write_review event with maxTimeToBeatHours",
                {
                    objectiveType: "write_review",
                    criteria: { maxTimeToBeatHours: 8 },
                },
            ],
            ["an unknown rank", { rank: "Z" }],
            ["a non-positive xpReward", { xpReward: 0 }],
            ["a targetCount below 1", { targetCount: 0 }],
            ["a blank title", { title: "   " }],
            ["an unknown objectiveType", { objectiveType: "collect_game" }],
        ])("rejects %s with 400", async (label, overrides) => {
            await postEvent(eventPayload(overrides)).expect(400);
        });
    });

    describe("event deadline propagation", () => {
        it("applies a shorter endsAt to active contracts only", async () => {
            const event = await createEvent();
            const activeId = await createContract(event.id);
            const readyId = await createContract(event.id, "ready_to_claim");
            const completedId = await createContract(event.id, "completed");
            const endsAt = "2099-06-30T00:00:00.000Z";

            const response = await patchEvent(event.id, { endsAt }).expect(200);
            expect(new Date(response.body.endsAt).toISOString()).toBe(endsAt);

            const rows: Array<{ id: string; expiresAt: Date | null }> =
                await source.query(
                    "SELECT id, expiresAt FROM guild_contract WHERE id IN (?, ?, ?)",
                    [activeId, readyId, completedId],
                );
            const byId = new Map(rows.map((row) => [row.id, row.expiresAt]));
            expect(new Date(byId.get(activeId)!).toISOString()).toBe(endsAt);
            expect(byId.get(readyId)).toBeNull();
            expect(byId.get(completedId)).toBeNull();
        });
    });

    describe("event translations", () => {
        it("rejects unsupported, duplicate and empty translations without mutating the stored set", async () => {
            const event = await createEvent({ translations: [EN, PT_BR] });

            await patchEvent(event.id, {
                translations: [{ ...EN, locale: "es" }],
            }).expect(400);
            await patchEvent(event.id, {
                translations: [EN, { ...EN, title: "Another" }],
            }).expect(400);
            await patchEvent(event.id, {
                translations: [{ ...EN, title: "  " }],
            }).expect(400);
            await patchEvent(event.id, {
                translations: [{ ...PT_BR, description: "" }],
            }).expect(400);

            const stored = await request(server())
                .get(`/v1/guild/admin/events/${event.id}`)
                .set("Authorization", as("editor"))
                .expect(200);
            expect(stored.body.translations).toEqual([EN, PT_BR]);
        });

        it("replaces, preserves and clears translations", async () => {
            const event = await createEvent({ translations: [EN, PT_BR] });
            const updatedPtBr = {
                locale: "pt-BR",
                title: "Narrativa atualizada",
                description: "Descrição atualizada",
            };

            await patchEvent(event.id, { translations: [updatedPtBr] })
                .expect(200)
                .expect(({ body }) =>
                    expect(body.translations).toEqual([updatedPtBr]),
                );

            await patchEvent(event.id, { title: "Renamed event" })
                .expect(200)
                .expect(({ body }) => {
                    expect(body.title).toBe("Renamed event");
                    expect(body.translations).toEqual([updatedPtBr]);
                });

            await patchEvent(event.id, { translations: [] })
                .expect(200)
                .expect(({ body }) => expect(body.translations).toEqual([]));
        });
    });

    describe("publishing and archiving", () => {
        it("rejects publishing after the window ended", async () => {
            const event = await createEvent({
                startsAt: "2000-01-01T00:00:00.000Z",
                endsAt: "2000-01-31T00:00:00.000Z",
            });
            await request(server())
                .post(`/v1/guild/admin/events/${event.id}/publish`)
                .set("Authorization", as("editor"))
                .expect(400);
        });

        it("rejects publishing a badge event whose achievement is not published", async () => {
            const badge = await createReward({
                key: `badge_draft_${randomUUID().slice(0, 8)}`,
                kind: "badge",
                achievementId: "guild-draft-badge",
            });
            const event = await createEvent({ rewardId: badge.id });

            await request(server())
                .post(`/v1/guild/admin/events/${event.id}/publish`)
                .set("Authorization", as("editor"))
                .expect(400);

            await source
                .getRepository(AchievementDefinition)
                .update(
                    { id: "guild-draft-badge" },
                    { status: AchievementStatus.PUBLISHED },
                );
            await request(server())
                .post(`/v1/guild/admin/events/${event.id}/publish`)
                .set("Authorization", as("editor"))
                .expect(201)
                .expect(({ body }) => {
                    expect(body.status).toBe("published");
                    expect(body.publishedAt).not.toBeNull();
                });
        });

        it("rejects publishing an archived event with 409", async () => {
            const event = await createEvent();
            await request(server())
                .post(`/v1/guild/admin/events/${event.id}/archive`)
                .set("Authorization", as("editor"))
                .expect(201)
                .expect(({ body }) => expect(body.status).toBe("archived"));

            await request(server())
                .post(`/v1/guild/admin/events/${event.id}/publish`)
                .set("Authorization", as("editor"))
                .expect(409);
        });

        it("archives a published event while preserving active contracts", async () => {
            const event = await createEvent();
            await request(server())
                .post(`/v1/guild/admin/events/${event.id}/publish`)
                .set("Authorization", as("editor"))
                .expect(201)
                .expect(({ body }) => expect(body.status).toBe("published"));

            const contractId = await createContract(event.id);
            await request(server())
                .post(`/v1/guild/admin/events/${event.id}/archive`)
                .set("Authorization", as("editor"))
                .expect(201);

            const [contract] = await source.query(
                "SELECT id, eventId, status, `rank`, xpReward FROM guild_contract WHERE id = ?",
                [contractId],
            );
            expect(contract).toMatchObject({
                id: contractId,
                eventId: event.id,
                status: "active",
                rank: "A",
                xpReward: 400,
            });
        });
    });

    describe("rules immutability after acceptance", () => {
        let event: Record<string, any>;
        let otherRewardId: string;

        beforeAll(async () => {
            const frame = await createReward({
                key: `frame_locked_${randomUUID().slice(0, 8)}`,
            });
            otherRewardId = (
                await createReward({
                    key: `frame_other_${randomUUID().slice(0, 8)}`,
                })
            ).id;
            event = await createEvent({
                rewardId: frame.id,
                translations: [EN, PT_BR],
            });
            await createContract(event.id);
        });

        it.each([
            ["xpReward", () => ({ xpReward: 999 })],
            ["criteria", () => ({ criteria: { genreIds: [9] } })],
            [
                "objectiveType",
                () => ({ objectiveType: "write_review", criteria: {} }),
            ],
            ["targetCount", () => ({ targetCount: 2 })],
            ["rewardId", () => ({ rewardId: otherRewardId })],
        ] as Array<[string, () => Record<string, unknown>]>)(
            "rejects a %s change with 409",
            async (_label, changes) => {
                const response = await patchEvent(event.id, changes()).expect(
                    409,
                );
                expect(response.body).toMatchObject({
                    code: "guild_event_rules_locked",
                });
            },
        );

        it("allows title, description, translations and endsAt updates", async () => {
            const extendedEndsAt = "2100-01-31T00:00:00.000Z";
            const response = await patchEvent(event.id, {
                title: "Updated title",
                description: "Updated description",
                translations: [PT_BR],
                endsAt: extendedEndsAt,
            }).expect(200);

            expect(response.body).toMatchObject({
                title: "Updated title",
                description: "Updated description",
                xpReward: 400,
                targetCount: 1,
            });
            expect(response.body.translations).toEqual([PT_BR]);
            expect(new Date(response.body.endsAt).toISOString()).toBe(
                extendedEndsAt,
            );
        });

        it("still validates the extended window", async () => {
            await patchEvent(event.id, {
                endsAt: "2098-11-30T00:00:00.000Z",
            }).expect(400);
        });
    });

    describe("badge rewards on published events", () => {
        it("only requires a published achievement once the event is published", async () => {
            const badge = await createReward({
                key: `badge_draft_link_${randomUUID().slice(0, 8)}`,
                kind: "badge",
                achievementId: "guild-admin-draft-badge",
            });

            const draft = await createEvent();
            await patchEvent(draft.id, { rewardId: badge.id })
                .expect(200)
                .expect(({ body }) => expect(body.reward.id).toBe(badge.id));

            const published = await createEvent();
            await publishEventRequest(published.id).expect(201);
            const response = await patchEvent(published.id, {
                rewardId: badge.id,
            }).expect(400);
            expect(response.body.message).toContain("published achievement");
        });

        it("accepts a published badge on a published event", async () => {
            const badge = await createReward({
                key: `badge_published_link_${randomUUID().slice(0, 8)}`,
                kind: "badge",
                achievementId: "guild-admin-published-badge",
            });
            const event = await createEvent();
            await publishEventRequest(event.id).expect(201);

            await patchEvent(event.id, { rewardId: badge.id })
                .expect(200)
                .expect(({ body }) => expect(body.reward.id).toBe(badge.id));
        });
    });

    describe("reward identity after unlocks", () => {
        const referenceByContract = (rewardId: string) =>
            source.query(
                "INSERT INTO guild_contract (id, profileUserId, category, `rank`, xpReward, objectiveType, criteria, acceptedAt, rewardId) VALUES (?, ?, 'event', 'A', 400, 'finish_game', '{}', NOW(6), ?)",
                [randomUUID(), READER_ID, rewardId],
            );

        const referenceByUnlock = (rewardId: string) =>
            source.query(
                "INSERT INTO user_guild_reward (profileUserId, rewardId, sourceContractId, unlockedAt) VALUES (?, ?, NULL, NOW(6))",
                [READER_ID, rewardId],
            );

        it.each(["contract", "unlock"])(
            "locks key, kind and achievementId once referenced by a %s",
            async (reference: string) => {
                const reward = await createReward({
                    key: `frame_identity_${randomUUID().slice(0, 8)}`,
                });
                if (reference === "contract") {
                    await referenceByContract(reward.id);
                } else {
                    await referenceByUnlock(reward.id);
                }

                for (const changes of [
                    { key: `frame_renamed_${randomUUID().slice(0, 8)}` },
                    { kind: "title" },
                    { achievementId: "guild-admin-published-badge" },
                ]) {
                    const response = await patchReward(
                        reward.id,
                        changes,
                    ).expect(409);
                    expect(response.body).toMatchObject({
                        code: "guild_reward_identity_locked",
                    });
                }
            },
        );

        it("still allows catalog-only edits on a referenced reward", async () => {
            const reward = await createReward({
                key: `frame_catalog_${randomUUID().slice(0, 8)}`,
            });
            await referenceByUnlock(reward.id);

            await patchReward(reward.id, {
                isActive: false,
                inChestPool: true,
                chestBonusXp: 25,
            })
                .expect(200)
                .expect(({ body }) =>
                    expect(body).toMatchObject({
                        isActive: false,
                        inChestPool: true,
                        chestBonusXp: 25,
                    }),
                );
        });

        it("allows identity edits on an unreferenced reward", async () => {
            const reward = await createReward({
                key: `frame_free_${randomUUID().slice(0, 8)}`,
            });
            const newKey = `badge_free_${randomUUID().slice(0, 8)}`;

            await patchReward(reward.id, {
                key: newKey,
                kind: "badge",
                achievementId: "guild-admin-published-badge",
            })
                .expect(200)
                .expect(({ body }) =>
                    expect(body).toMatchObject({
                        key: newKey,
                        kind: "badge",
                        achievementId: "guild-admin-published-badge",
                    }),
                );
        });

        it("refuses to turn a published event's reward into a draft badge", async () => {
            const reward = await createReward({
                key: `frame_published_${randomUUID().slice(0, 8)}`,
            });
            const event = await createEvent({ rewardId: reward.id });
            await publishEventRequest(event.id).expect(201);

            await patchReward(reward.id, {
                kind: "badge",
                achievementId: "guild-admin-draft-badge",
            }).expect(400);
            await patchReward(reward.id, {
                kind: "badge",
                achievementId: "guild-admin-published-badge",
            })
                .expect(200)
                .expect(({ body }) =>
                    expect(body).toMatchObject({
                        kind: "badge",
                        achievementId: "guild-admin-published-badge",
                    }),
                );
        });
    });

    describe("event row lock", () => {
        it("waits for the event lock before rejecting rules edits with a new contract", async () => {
            const event = await createEvent();
            const runner = source.createQueryRunner();
            await runner.connect();
            await runner.startTransaction();
            let settled = false;
            try {
                await runner.query(
                    "SELECT id FROM guild_event WHERE id = ? FOR UPDATE",
                    [event.id],
                );
                await runner.query(
                    "INSERT INTO guild_contract (id, profileUserId, eventId, category, `rank`, xpReward, objectiveType, criteria, acceptedAt) VALUES (?, ?, ?, 'event', 'A', 400, 'finish_game', '{}', NOW(6))",
                    [randomUUID(), READER_ID, event.id],
                );

                const pending = patchEvent(event.id, { xpReward: 999 }).then(
                    (response) => {
                        settled = true;
                        return response;
                    },
                );
                await new Promise((resolve) => setTimeout(resolve, 200));
                expect(settled).toBe(false);

                await runner.commitTransaction();
                const response = await pending;
                expect(response.status).toBe(409);
                expect(response.body).toMatchObject({
                    code: "guild_event_rules_locked",
                });
            } finally {
                if (runner.isTransactionActive) {
                    await runner.rollbackTransaction();
                }
                await runner.release();
            }
        });

        it("waits for the event lock before archiving", async () => {
            const event = await createEvent();
            const runner = source.createQueryRunner();
            await runner.connect();
            await runner.startTransaction();
            let settled = false;
            try {
                await runner.query(
                    "SELECT id FROM guild_event WHERE id = ? FOR UPDATE",
                    [event.id],
                );
                const pending = request(server())
                    .post(`/v1/guild/admin/events/${event.id}/archive`)
                    .set("Authorization", as("editor"))
                    .then((response) => {
                        settled = true;
                        return response;
                    });
                await new Promise((resolve) => setTimeout(resolve, 200));
                expect(settled).toBe(false);

                await runner.commitTransaction();
                const response = await pending;
                expect(response.status).toBe(201);
                expect(response.body).toMatchObject({ status: "archived" });
            } finally {
                if (runner.isTransactionActive) {
                    await runner.rollbackTransaction();
                }
                await runner.release();
            }
        });
    });

    it("returns 404 for unknown events and rewards", async () => {
        await request(server())
            .get(`/v1/guild/admin/events/${randomUUID()}`)
            .set("Authorization", as("editor"))
            .expect(404);
        await request(server())
            .patch(`/v1/guild/admin/rewards/${randomUUID()}`)
            .set("Authorization", as("editor"))
            .send({ isActive: false })
            .expect(404);
    });
});
