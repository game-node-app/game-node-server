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

    const createEvent = async (overrides: Record<string, unknown> = {}) => {
        const response = await postEvent(eventPayload(overrides)).expect(201);
        return response.body;
    };

    const createReward = async (overrides: Record<string, unknown> = {}) => {
        const response = await postReward(rewardPayload(overrides)).expect(201);
        return response.body;
    };

    const createContract = async (eventId: string) => {
        const id = randomUUID();
        await source.query(
            `INSERT INTO guild_contract
                (id, profileUserId, eventId, category, \`rank\`, xpReward, objectiveType, criteria, acceptedAt)
             VALUES (?, ?, ?, 'event', 'A', 400, 'finish_game', '{}', NOW(6))`,
            [id, READER_ID, eventId],
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
