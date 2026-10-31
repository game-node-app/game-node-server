import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { achievementFixtures } from "../../test/achievements/achievement-fixtures";
import { AchievementsAdminService } from "./achievements-admin.service";
import { AchievementsAdminController } from "./achievements-admin.controller";
import { AchievementsProgressService } from "./achievements-progress.service";
import { AchievementDefinition } from "./entities/achievement-definition.entity";
import { AchievementEvent } from "./entities/achievement-event.entity";
import { AchievementProgress } from "./entities/achievement-progress.entity";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { UserLevel } from "../level/entities/user-level.entity";
import {
    AchievementCategory,
    AchievementStatus,
} from "./achievements.constants";
import { CreateAchievementDefinitionDto } from "./dto/achievement-admin.dto";
import { randomUUID } from "node:crypto";

describe("AchievementsAdminService (integration)", () => {
    let ds: DataSource;
    let f: ReturnType<typeof achievementFixtures>;
    let service: AchievementsAdminService;
    let progress: AchievementsProgressService;
    const queue = { addBackfillJob: jest.fn() };

    const slug = () => `c-${randomUUID().slice(0, 20)}`;
    const draft = (
        overrides: Partial<CreateAchievementDefinitionDto> = {},
    ): CreateAchievementDefinitionDto => ({
        id: slug(),
        name: "Horror critic",
        description: "Review horror games",
        category: AchievementCategory.REVIEWS,
        metric: "reviews_written",
        criteria: { themeIds: [19] },
        icon: { kind: "glyph", name: "ghost" },
        tiers: [
            { threshold: 1, expReward: 50 },
            { threshold: 5, expReward: 100 },
            { threshold: 25, expReward: 500 },
        ],
        ...overrides,
    });

    beforeAll(async () => {
        ds = await createNotificationTestDataSource();
        f = achievementFixtures(ds);
        progress = new AchievementsProgressService(ds, {} as any, {} as any);
        service = new AchievementsAdminService(
            ds.getRepository(AchievementDefinition),
            ds.getRepository(AchievementEvent),
            ds,
            queue as any,
            progress,
        );
    });

    beforeEach(() => queue.addBackfillJob.mockReset());

    afterAll(() => ds?.destroy());

    it("lists the metric catalog with filters and window support", () => {
        const metrics = service.getMetrics();
        expect(metrics.map((metric) => metric.key)).toEqual([
            "reviews_written",
            "library_games",
            "games_finished",
            "followers",
            "comments_written",
            "awards_participation",
            "manual",
        ]);
        expect(
            metrics.find((metric) => metric.key === "reviews_written"),
        ).toEqual(
            expect.objectContaining({
                filters: ["gameIds", "themeIds", "genreIds"],
                supportsWindow: true,
            }),
        );
        expect(metrics.every((metric) => metric.description.length > 0)).toBe(
            true,
        );
    });

    it("creates drafts with ordered tiers", async () => {
        const created = await service.createDefinition(
            draft({ id: "horror-critic-" + randomUUID().slice(0, 8) }),
        );

        expect(created.status).toBe(AchievementStatus.DRAFT);
        expect(
            created.tiers.map((tier) => [tier.level, tier.threshold]),
        ).toEqual([
            [1, 1],
            [2, 5],
            [3, 25],
        ]);
    });

    it.each([
        [
            "equal thresholds",
            {
                tiers: [
                    { threshold: 5, expReward: 0 },
                    { threshold: 5, expReward: 0 },
                ],
            },
        ],
        [
            "decreasing thresholds",
            {
                tiers: [
                    { threshold: 10, expReward: 0 },
                    { threshold: 3, expReward: 0 },
                ],
            },
        ],
        [
            "an unsupported filter",
            { metric: "followers", criteria: { themeIds: [19] } },
        ],
        ["an unknown metric", { metric: "steps_walked", criteria: {} }],
        [
            "a window and an event",
            {
                startsAt: new Date("2026-01-01"),
                endsAt: new Date("2026-02-01"),
                eventId: randomUUID(),
            },
        ],
        [
            "a window on a metric without window support",
            {
                metric: "awards_participation",
                criteria: { year: 2025 },
                startsAt: new Date("2026-01-01"),
                endsAt: new Date("2026-02-01"),
            },
        ],
        [
            "a window ending before it starts",
            {
                startsAt: new Date("2026-02-01"),
                endsAt: new Date("2026-01-01"),
            },
        ],
        [
            "a missing cover game",
            { icon: { kind: "game_cover" as const, gameId: 2_000_000_000 } },
        ],
        [
            "a missing image icon",
            { icon: { kind: "image" as const, name: "does-not-exist" } },
        ],
        [
            "a non kebab-case glyph",
            { icon: { kind: "glyph" as const, name: "ghost_face" } },
        ],
    ])("rejects %s and saves nothing", async (_, overrides) => {
        const dto = draft(overrides as any);
        await expect(service.createDefinition(dto)).rejects.toMatchObject({
            status: 400,
        });
        expect(
            await ds
                .getRepository(AchievementDefinition)
                .existsBy({ id: dto.id }),
        ).toBe(false);
    });

    it("names the unsupported filter", async () => {
        await expect(
            service.createDefinition(
                draft({ metric: "followers", criteria: { themeIds: [19] } }),
            ),
        ).rejects.toThrow(/themeIds/);
    });

    it("accepts a cover of an existing game", async () => {
        const gameId = await f.game();
        const created = await service.createDefinition(
            draft({ icon: { kind: "game_cover", gameId } }),
        );
        expect(created.icon).toEqual({ kind: "game_cover", gameId });
    });

    it("rejects duplicate slugs, including archived ones, without changing the existing definition", async () => {
        const archived = await f.definition("manual", {}, [[1, 0]], {
            status: AchievementStatus.ARCHIVED,
        });

        await expect(
            service.createDefinition(draft({ id: archived.id })),
        ).rejects.toMatchObject({ status: 409 });
        expect((await service.findDefinitionOrFail(archived.id)).metric).toBe(
            "manual",
        );
    });

    it("publishes, freezes criteria and thresholds, appends tiers and archives", async () => {
        const { id } = await service.createDefinition(draft());
        const published = await service.publishDefinition(id);
        expect(published.status).toBe(AchievementStatus.PUBLISHED);
        expect(published.publishedAt).toBeInstanceOf(Date);
        expect(queue.addBackfillJob).toHaveBeenCalledWith({
            definitionId: id,
            afterUserId: null,
            generation: 3,
        });

        const tiers = published.tiers.map(({ threshold, expReward }) => ({
            threshold,
            expReward,
        }));
        for (const change of [
            { metric: "library_games" },
            { criteria: { themeIds: [20] } },
            { tiers: [{ threshold: 2, expReward: 50 }, ...tiers.slice(1)] },
            { tiers: tiers.slice(0, 2) },
        ]) {
            await expect(
                service.updateDefinition(id, change),
            ).rejects.toMatchObject({ status: 400 });
        }
        expect(await service.findDefinitionOrFail(id)).toEqual(published);
        await expect(service.deleteDefinition(id)).rejects.toMatchObject({
            status: 400,
        });

        const renamed = await service.updateDefinition(id, { name: "Renamed" });
        expect(renamed.name).toBe("Renamed");
        expect(queue.addBackfillJob).toHaveBeenCalledTimes(1);

        await expect(
            service.updateDefinition(id, {
                tiers: [...tiers, { threshold: 20, expReward: 0 }],
            }),
        ).rejects.toMatchObject({ status: 400 });
        const extended = await service.updateDefinition(id, {
            tiers: [...tiers, { threshold: 100, expReward: 1000 }],
        });
        expect(extended.tiers.map((tier) => tier.level)).toEqual([1, 2, 3, 4]);
        expect(queue.addBackfillJob).toHaveBeenLastCalledWith({
            definitionId: id,
            afterUserId: null,
            generation: 4,
        });

        const archived = await service.archiveDefinition(id);
        expect(archived.status).toBe(AchievementStatus.ARCHIVED);
        expect(await progress.findEvaluable({ id })).toEqual([]);
        await expect(
            service.updateDefinition(id, { name: "Again" }),
        ).rejects.toMatchObject({ status: 400 });
    });

    it("edits and deletes drafts", async () => {
        const { id } = await service.createDefinition(draft());
        const edited = await service.updateDefinition(id, {
            metric: "followers",
            criteria: {},
            tiers: [{ threshold: 10, expReward: 10 }],
        });
        expect(edited.metric).toBe("followers");
        expect(edited.tiers.map((tier) => tier.threshold)).toEqual([10]);
        expect(await progress.findEvaluable({ id })).toEqual([]);

        await service.deleteDefinition(id);
        expect(
            await ds.getRepository(AchievementDefinition).existsBy({ id }),
        ).toBe(false);
    });

    it("simulates a draft without changing any user state", async () => {
        const user = await f.user();
        const game = await f.game([19]);
        await f.review(user, game);
        await f.review(user, game);
        const { id } = await service.createDefinition(
            draft({ criteria: { gameIds: [game] } }),
        );
        const snapshot = () =>
            Promise.all([
                ds
                    .getRepository(ObtainedAchievement)
                    .countBy({ profileUserId: user }),
                ds
                    .getRepository(AchievementProgress)
                    .countBy({ profileUserId: user }),
                ds
                    .getRepository(NotificationOutbox)
                    .countBy({ recipientUserId: user }),
                ds.getRepository(UserLevel).countBy({ userId: user }),
            ]);
        const before = await snapshot();

        expect(await service.simulateDefinition(id, user)).toEqual({
            value: 2,
            levels: [1],
        });
        expect(await snapshot()).toEqual(before);
    });

    it("runs events through the editorial cycle, with an immutable start and an extend-only end", async () => {
        const event = await service.createEvent({
            slug: `spooky-${randomUUID().slice(0, 8)}`,
            name: "Spooky month",
            description: "",
            startsAt: new Date("2026-10-01T00:00:00Z"),
            endsAt: new Date("2026-11-01T00:00:00Z"),
        });
        expect(event.status).toBe(AchievementStatus.DRAFT);
        await expect(
            service.createEvent({
                slug: event.slug,
                name: "x",
                description: "",
                startsAt: event.startsAt,
                endsAt: event.endsAt,
            }),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
            service.updateEvent(event.id, {
                endsAt: new Date("2026-09-01T00:00:00Z"),
            }),
        ).rejects.toMatchObject({ status: 400 });

        const { id } = await service.createDefinition(
            draft({ eventId: event.id }),
        );
        await service.publishDefinition(id);
        expect(await progress.findEvaluable({ id })).toEqual([]);
        queue.addBackfillJob.mockReset();

        await service.publishEvent(event.id);
        expect(queue.addBackfillJob).toHaveBeenCalledWith({
            definitionId: id,
            afterUserId: null,
            generation: 3,
        });
        expect(await progress.findEvaluable({ id })).toHaveLength(1);
        await expect(service.deleteEvent(event.id)).rejects.toMatchObject({
            status: 400,
        });

        await expect(
            service.updateEvent(event.id, {
                startsAt: new Date("2026-10-02T00:00:00Z"),
            }),
        ).rejects.toMatchObject({ status: 400 });
        await expect(
            service.updateEvent(event.id, {
                endsAt: new Date("2026-10-20T00:00:00Z"),
            }),
        ).rejects.toMatchObject({ status: 400 });
        const extended = await service.updateEvent(event.id, {
            endsAt: new Date("2026-11-15T00:00:00Z"),
        });
        expect(extended.endsAt).toEqual(new Date("2026-11-15T00:00:00Z"));
        const [definition] = await progress.findEvaluable({ id });
        expect(definition.event!.endsAt).toEqual(
            new Date("2026-11-15T00:00:00Z"),
        );

        expect((await service.archiveEvent(event.id)).status).toBe(
            AchievementStatus.ARCHIVED,
        );
        expect(await progress.findEvaluable({ id })).toEqual([]);
    });

    it("restricts every admin route to admins and editors", () => {
        const handlers = Object.getOwnPropertyNames(
            AchievementsAdminController.prototype,
        ).filter((name) => name !== "constructor");
        expect(handlers.length).toBeGreaterThan(10);
        for (const name of handlers) {
            const handler = (AchievementsAdminController.prototype as any)[
                name
            ];
            expect([name, Reflect.getMetadata("roles", handler)]).toEqual([
                name,
                ["admin", "editor"],
            ]);
        }
    });
});
