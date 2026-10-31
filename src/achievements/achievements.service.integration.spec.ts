import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { achievementFixtures } from "../../test/achievements/achievement-fixtures";
import { AchievementsService } from "./achievements.service";
import { AchievementsController } from "./achievements.controller";
import { AchievementsV2Controller } from "./v2/achievements-v2.controller";
import { AchievementsProgressService } from "./achievements-progress.service";
import { AchievementsCodeService } from "./achievements-code.service";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { AchievementEvent } from "./entities/achievement-event.entity";
import { AchievementProgress } from "./entities/achievement-progress.entity";
import { AchievementCode } from "./entities/achievement-code.entity";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { AchievementStatus } from "./achievements.constants";

const session = (userId: string) => ({ getUserId: () => userId }) as any;

describe("achievement reads (integration)", () => {
    let ds: DataSource;
    let f: ReturnType<typeof achievementFixtures>;
    let progress: AchievementsProgressService;
    let service: AchievementsService;
    let v1: AchievementsController;
    let v2: AchievementsV2Controller;
    const cache = new Map<string, unknown>();
    const cacheManager = {
        get: jest.fn(async (key: string) => cache.get(key)),
        set: jest.fn(
            async (key: string, value: unknown) => void cache.set(key, value),
        ),
    };

    const all = { offset: 0, limit: 100_000 };

    beforeAll(async () => {
        ds = await createNotificationTestDataSource();
        f = achievementFixtures(ds);
        progress = new AchievementsProgressService(
            ds,
            new LevelService(ds.getRepository(UserLevel)),
            { register: jest.fn() } as any,
        );
        service = new AchievementsService(
            ds.getRepository(ObtainedAchievement),
            ds.getRepository(AchievementEvent),
            ds.getRepository(AchievementProgress),
            progress,
            cacheManager as any,
        );
        v1 = new AchievementsController(service);
        v2 = new AchievementsV2Controller(service);
    });

    afterAll(() => ds?.destroy());

    it("v1 catalog keeps the legacy shape and omits drafts, archived, hidden and unpublished-event definitions", async () => {
        const visible = await f.definition("manual", {}, [
            [1, 75],
            [2, 300],
        ]);
        const hidden = await f.definition("manual", {}, [[1, 0]], {
            isHidden: true,
        });
        const draft = await f.definition("manual", {}, [[1, 0]], {
            status: AchievementStatus.DRAFT,
        });
        const archived = await f.definition("manual", {}, [[1, 0]], {
            status: AchievementStatus.ARCHIVED,
        });
        const draftEvent = await f.event(
            new Date(),
            new Date(Date.now() + 1000),
            AchievementStatus.DRAFT,
        );
        const ofDraftEvent = await f.definition(
            "reviews_written",
            {},
            [[1, 0]],
            { eventId: draftEvent.id },
        );

        const [items] = await v1.getAchievements(all);
        const ids = items.map((item) => item.id);

        expect(items.find((item) => item.id === visible.id)).toStrictEqual({
            id: visible.id,
            name: visible.name,
            description: visible.description,
            expGainAmount: 75,
            category: visible.category,
        });
        for (const omitted of [hidden, draft, archived, ofDraftEvent]) {
            expect(ids).not.toContain(omitted.id);
        }
    });

    it("v1 obtained lists one item per definition at the highest tier, in the legacy shape, with derived featuring", async () => {
        const user = await f.user();
        const tiered = await f.definition("manual", {}, [
            [1, 10],
            [2, 20],
            [3, 30],
        ]);
        const single = await f.definition("manual", {}, [[1, 10]]);
        await progress.grantTiers(user, tiered, [1], "live");
        await progress.grantTiers(user, single, [1], "live");

        await v1.updateFeaturedObtainedAchievement(session(user), tiered.id, {
            isFeatured: true,
        });
        await progress.grantTiers(user, tiered, [2], "live");

        const obtained = await v1.getAllObtainedAchievements({
            targetUserId: user,
        });
        expect(obtained).toHaveLength(2);
        const item = obtained.find((row) => row.achievementId === tiered.id)!;
        // Compared as serialized, like the HTTP response
        expect(Object.keys(JSON.parse(JSON.stringify(item))).sort()).toEqual([
            "achievement",
            "achievementId",
            "createdAt",
            "id",
            "isFeatured",
            "profileUserId",
            "updatedAt",
        ]);
        expect(item.isFeatured).toBe(true);
        expect(item.achievement).toStrictEqual({
            id: tiered.id,
            name: tiered.name,
            description: tiered.description,
            expGainAmount: 10,
            category: tiered.category,
        });
        const tier2 = await ds
            .getRepository(ObtainedAchievement)
            .findOneByOrFail({
                profileUserId: user,
                achievementId: tiered.id,
                tier: 2,
            });
        expect(item.id).toBe(tier2.id);

        const featured = await v1.getAllObtainedAchievements({
            targetUserId: user,
            isFeatured: true,
        });
        expect(featured.map((row) => row.achievementId)).toEqual([tiered.id]);
        expect(
            (await v1.getObtainedAchievement(single.id, { targetUserId: user }))
                .achievementId,
        ).toBe(single.id);
        await expect(
            v1.getObtainedAchievement("missing", { targetUserId: user }),
        ).rejects.toMatchObject({ status: 404 });

        // Featuring a definition the user has not obtained has no effect
        const other = await f.definition("manual", {}, [[1, 0]]);
        await v2.updateFeaturedObtainedAchievements(session(user), {
            featuredAchievementIds: [single.id, other.id],
        });
        const afterV2 = await v1.getAllObtainedAchievements({
            targetUserId: user,
            isFeatured: true,
        });
        expect(afterV2.map((row) => row.achievementId)).toEqual([single.id]);

        // Archived definitions stay on profiles
        await ds.query(
            "UPDATE achievement_definition SET status = 'archived' WHERE id = ?",
            [single.id],
        );
        expect(
            (await v1.getAllObtainedAchievements({ targetUserId: user }))
                .map((row) => row.achievementId)
                .sort(),
        ).toEqual([tiered.id, single.id].sort());
    });

    it("manual grants and codes grant tier 1 once", async () => {
        const [user, admin] = [await f.user(), await f.user()];
        const definition = await f.definition("manual", {}, [[1, 100]]);
        const draft = await f.definition("manual", {}, [[1, 100]], {
            status: AchievementStatus.DRAFT,
        });

        await v1.grantAchievements({
            targetUserIds: [user],
            achievementId: definition.id,
        });
        const level = await ds
            .getRepository(UserLevel)
            .findOneByOrFail({ userId: user });
        await expect(
            v1.grantAchievements({
                targetUserIds: [user],
                achievementId: definition.id,
            }),
        ).rejects.toMatchObject({ status: 400 });
        expect(
            await ds.getRepository(UserLevel).findOneByOrFail({ userId: user }),
        ).toEqual(level);
        await expect(
            v1.grantAchievements({
                targetUserIds: [user],
                achievementId: draft.id,
            }),
        ).rejects.toMatchObject({ status: 400 });

        const codes = new AchievementsCodeService(
            ds.getRepository(AchievementCode),
            service,
        );
        const other = await f.definition("manual", {}, [[1, 100]]);
        await expect(
            codes.create(admin, {
                achievementId: draft.id,
                expiresAt: new Date(Date.now() + 60_000),
                isSingleUse: true,
            }),
        ).rejects.toMatchObject({ status: 400 });
        const { code } = await codes.create(admin, {
            achievementId: other.id,
            expiresAt: new Date(Date.now() + 60_000),
            isSingleUse: true,
        });
        await codes.consume(user, code);
        expect(
            await ds
                .getRepository(ObtainedAchievement)
                .findBy({ profileUserId: user, achievementId: other.id }),
        ).toEqual([expect.objectContaining({ tier: 1 })]);
    });

    it("v2 catalog exposes tiers, icon, event, window and cached rarity, masking unobtained hidden definitions", async () => {
        const [owner, stranger] = [await f.user(), await f.user()];
        const event = await f.event(
            new Date("2026-10-01T00:00:00Z"),
            new Date("2026-11-01T00:00:00Z"),
        );
        const ofEvent = await f.definition(
            "reviews_written",
            { themeIds: [19] },
            [
                [1, 10],
                [3, 30],
            ],
            { eventId: event.id },
        );
        const secret = await f.definition("manual", {}, [[1, 0]], {
            isHidden: true,
        });
        await progress.grantTiers(owner, ofEvent, [1], "live");
        await progress.grantTiers(owner, secret, [1], "live");
        cache.clear();

        const [items] = await v2.getAchievements({ ...all });
        const item = items.find((row) => row.id === ofEvent.id)!;
        const totalProfiles = cacheManager.set.mock.calls.at(-1)![1] as number;
        expect(cacheManager.set).toHaveBeenLastCalledWith(
            "achievements:total-profiles",
            totalProfiles,
            3_600_000,
        );
        expect(item).toMatchObject({
            name: ofEvent.name,
            metric: "reviews_written",
            criteria: { themeIds: [19] },
            icon: { kind: "glyph", name: "star" },
            event: { id: event.id, slug: event.slug, name: event.name },
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            tiers: [
                {
                    level: 1,
                    threshold: 1,
                    expReward: 10,
                    obtainedCount: 1,
                    rarity: 1 / totalProfiles,
                },
                {
                    level: 2,
                    threshold: 3,
                    expReward: 30,
                    obtainedCount: 0,
                    rarity: 0,
                },
            ],
        });
        expect(items.find((row) => row.id === secret.id)).toMatchObject({
            isHidden: true,
            name: null,
            description: null,
            metric: null,
            criteria: null,
            icon: null,
        });

        const [forStranger] = await v2.getAchievements({
            ...all,
            targetUserId: stranger,
        });
        expect(
            forStranger.find((row) => row.id === secret.id)!.name,
        ).toBeNull();
        const [forOwner] = await v2.getAchievements({
            ...all,
            targetUserId: owner,
        });
        expect(forOwner.find((row) => row.id === secret.id)!.name).toBe(
            secret.name,
        );
        expect(cacheManager.set).toHaveBeenCalledTimes(1);
    });

    it("v2 progress returns value, highest tier and next threshold for visible definitions", async () => {
        const user = await f.user();
        for (let index = 0; index < 37; index++)
            await f.entry(user, await f.game());
        const library = await f.definition("library_games", {}, [
            [10, 0],
            [50, 0],
            [100, 0],
        ]);
        const never = await f.definition("followers", {}, [[1_000_000, 0]]);
        const secret = await f.definition("followers", {}, [[1_000_000, 0]], {
            isHidden: true,
        });
        await progress.evaluate(user, "library_games");

        const rows = await v2.getProgress(user);

        expect(rows.find((row) => row.achievementId === library.id)).toEqual({
            achievementId: library.id,
            value: 37,
            tier: 1,
            nextThreshold: 50,
        });
        expect(rows.find((row) => row.achievementId === never.id)).toEqual({
            achievementId: never.id,
            value: 0,
            tier: 0,
            nextThreshold: 1_000_000,
        });
        expect(rows.map((row) => row.achievementId)).not.toContain(secret.id);
    });

    it("v2 events splits published events into active, upcoming and past", async () => {
        const hour = 3_600_000;
        const active = await f.event(
            new Date(Date.now() - hour),
            new Date(Date.now() + hour),
        );
        const upcoming = await f.event(
            new Date(Date.now() + hour),
            new Date(Date.now() + 2 * hour),
        );
        const past = await f.event(
            new Date(Date.now() - 2 * hour),
            new Date(Date.now() - hour),
        );
        const draft = await f.event(
            new Date(Date.now() - hour),
            new Date(Date.now() + hour),
            AchievementStatus.DRAFT,
        );

        const events = await v2.getEvents();
        const ids = (list: Array<{ id: string }>) =>
            list.map((event) => event.id);

        expect(ids(events.active)).toContain(active.id);
        expect(ids(events.upcoming)).toContain(upcoming.id);
        expect(ids(events.past)).toContain(past.id);
        expect([
            ...ids(events.active),
            ...ids(events.upcoming),
            ...ids(events.past),
        ]).not.toContain(draft.id);
    });
});
