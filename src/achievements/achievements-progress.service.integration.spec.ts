import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { achievementFixtures } from "../../test/achievements/achievement-fixtures";
import { AchievementsProgressService } from "./achievements-progress.service";
import { LevelService } from "../level/level.service";
import { UserLevel } from "../level/entities/user-level.entity";
import { ObtainedAchievement } from "./entities/obtained-achievement.entity";
import { AchievementTier } from "./entities/achievement-tier.entity";
import { AchievementProgress } from "./entities/achievement-progress.entity";
import { NotificationOutbox } from "../notifications/entity/notification-outbox.entity";
import { AchievementDefinition } from "./entities/achievement-definition.entity";
import { AchievementStatus } from "./achievements.constants";
import { ActivityType } from "../activities/activities-queue/activities-queue.constants";
import { ACHIEVEMENT_METRICS } from "./metrics/achievement-metrics";

describe("AchievementsProgressService (integration)", () => {
    let ds: DataSource;
    let f: ReturnType<typeof achievementFixtures>;
    let service: AchievementsProgressService;
    let levelService: LevelService;
    const activities = { register: jest.fn() };

    const tiersOf = (userId: string, definitionId: string) =>
        ds
            .getRepository(ObtainedAchievement)
            .find({
                where: { profileUserId: userId, achievementId: definitionId },
                order: { tier: "ASC" },
            })
            .then((rows) => rows.map((row) => row.tier));
    const intentsOf = async (userId: string, definitionId: string) =>
        (
            await ds.getRepository(NotificationOutbox).find({
                where: {
                    recipientUserId: userId,
                    eventType: "achievement.unlocked",
                },
            })
        ).filter((row) => row.payload.achievementId === definitionId);
    const progressOf = (userId: string, definitionId: string) =>
        ds
            .getRepository(AchievementProgress)
            .findOneBy({ profileUserId: userId, definitionId })
            .then((row) => row?.value);
    const countOf = (definitionId: string, level: number) =>
        ds
            .getRepository(AchievementTier)
            .findOneByOrFail({ definitionId, level })
            .then((tier) => tier.obtainedCount);

    beforeAll(async () => {
        ds = await createNotificationTestDataSource();
        f = achievementFixtures(ds);
        levelService = new LevelService(ds.getRepository(UserLevel));
        service = new AchievementsProgressService(
            ds,
            levelService,
            activities as any,
        );
    });

    beforeEach(() => {
        activities.register.mockReset();
        jest.restoreAllMocks();
    });

    afterAll(() => ds?.destroy());

    it("grants every reached tier at once with summed exp, one notification and one activity", async () => {
        const user = await f.user();
        const game = await f.game();
        const definition = await f.definition(
            "reviews_written",
            { gameIds: [game] },
            [
                [1, 50],
                [2, 150],
                [5, 400],
            ],
        );
        await f.review(user, game);
        await f.review(user, game);
        const increaseExp = jest.spyOn(levelService, "increaseExp");

        await service.evaluate(user, "reviews_written");

        expect(await tiersOf(user, definition.id)).toEqual([1, 2]);
        expect(await progressOf(user, definition.id)).toBe(2);
        expect(increaseExp).toHaveBeenCalledTimes(1);
        expect(increaseExp).toHaveBeenCalledWith(user, 200, expect.anything());
        expect(
            (
                await ds
                    .getRepository(UserLevel)
                    .findOneByOrFail({ userId: user })
            ).currentLevel,
        ).toBeGreaterThan(1);
        expect(await countOf(definition.id, 2)).toBe(1);
        const intents = await intentsOf(user, definition.id);
        expect(intents).toHaveLength(1);
        expect(intents[0].payload).toEqual(
            expect.objectContaining({ tier: 2 }),
        );
        expect(intents[0].actorUserId).toBeNull();
        expect(activities.register).toHaveBeenCalledTimes(1);
        expect(activities.register).toHaveBeenCalledWith(
            expect.objectContaining({
                type: ActivityType.ACHIEVEMENT_UNLOCKED,
                sourceId: intents[0].payload.obtainedAchievementId,
                profileUserId: user,
            }),
            expect.any(String),
        );

        // Re-evaluating changes nothing
        await service.evaluate(user, "reviews_written");
        expect(increaseExp).toHaveBeenCalledTimes(1);
        expect(await intentsOf(user, definition.id)).toHaveLength(1);
    });

    it("concurrent grants of the same tier produce one row, one exp grant and one notification", async () => {
        const user = await f.user();
        const definition = await f.definition("manual", {}, [[1, 100]]);
        const increaseExp = jest.spyOn(levelService, "increaseExp");

        const results = await Promise.all([
            service.grantTiers(user, definition, [1], "live"),
            service.grantTiers(user, definition, [1], "live"),
            service.grantTiers(user, definition, [1], "live"),
        ]);

        expect(results.filter(Boolean)).toHaveLength(1);
        expect(await tiersOf(user, definition.id)).toEqual([1]);
        expect(increaseExp).toHaveBeenCalledTimes(1);
        expect(await countOf(definition.id, 1)).toBe(1);
        expect(await intentsOf(user, definition.id)).toHaveLength(1);
    });

    it("keeps obtained tiers when the metric drops and does not grant them again", async () => {
        const user = await f.user();
        const followers = await Promise.all([f.user(), f.user(), f.user()]);
        for (const follower of followers) await f.follow(follower, user);
        const definition = await f.definition("followers", {}, [[3, 10]]);
        await service.evaluate(user, "followers");
        expect(await tiersOf(user, definition.id)).toEqual([1]);

        await ds.query(
            "DELETE FROM user_follow WHERE followedUserId = ? LIMIT 1",
            [user],
        );
        await service.evaluate(user, "followers");
        expect(await tiersOf(user, definition.id)).toEqual([1]);
        expect(await progressOf(user, definition.id)).toBe(2);

        await f.follow(await f.user(), user);
        await service.evaluate(user, "followers");
        expect(await intentsOf(user, definition.id)).toHaveLength(1);
        expect(await countOf(definition.id, 1)).toBe(1);
    });

    it("ignores drafts, archived definitions and definitions of unpublished events, and counts only facts in the event window", async () => {
        const user = await f.user();
        const game = await f.game();
        const criteria = { gameIds: [game] };
        await f.review(user, game, new Date("2026-10-10T00:00:00Z"));
        await f.review(user, game, new Date("2026-09-10T00:00:00Z"));
        const draft = await f.definition(
            "reviews_written",
            criteria,
            [[1, 0]],
            { status: AchievementStatus.DRAFT },
        );
        const archived = await f.definition(
            "reviews_written",
            criteria,
            [[1, 0]],
            { status: AchievementStatus.ARCHIVED },
        );
        const draftEvent = await f.event(
            new Date("2026-10-01T00:00:00Z"),
            new Date("2026-11-01T00:00:00Z"),
            AchievementStatus.DRAFT,
        );
        const ofDraftEvent = await f.definition(
            "reviews_written",
            criteria,
            [[1, 0]],
            { eventId: draftEvent.id },
        );
        const event = await f.event(
            new Date("2026-10-01T00:00:00Z"),
            new Date("2026-11-01T00:00:00Z"),
        );
        const ofEvent = await f.definition(
            "reviews_written",
            criteria,
            [
                [1, 0],
                [2, 0],
            ],
            { eventId: event.id },
        );

        await service.evaluate(user, "reviews_written");

        expect(await tiersOf(user, draft.id)).toEqual([]);
        expect(await tiersOf(user, archived.id)).toEqual([]);
        expect(await tiersOf(user, ofDraftEvent.id)).toEqual([]);
        expect(await progressOf(user, draft.id)).toBeUndefined();
        expect(await tiersOf(user, ofEvent.id)).toEqual([1]);
        expect(await progressOf(user, ofEvent.id)).toBe(1);
    });

    it("computes definitions sharing criteria and window once", async () => {
        const user = await f.user();
        const game = await f.game();
        await f.definition("reviews_written", { gameIds: [game] }, [[1, 0]]);
        await f.definition("reviews_written", { gameIds: [game] }, [[5, 0]]);
        const compute = jest.spyOn(
            ACHIEVEMENT_METRICS.get("reviews_written")!,
            "compute",
        );

        await service.evaluate(user, "reviews_written");

        const calls = compute.mock.calls.filter(
            ([, , criteria]) => criteria.gameIds?.[0] === game,
        );
        expect(calls).toHaveLength(1);
    });

    it("manual grants refuse tiers the user already has without changing exp", async () => {
        const user = await f.user();
        const definition = await f.definition("manual", {}, [[1, 100]]);
        await service.grantTiers(user, definition, [1], "manual");
        const before = await ds
            .getRepository(UserLevel)
            .findOneByOrFail({ userId: user });

        await expect(
            service.grantTiers(user, definition, [1], "manual"),
        ).rejects.toThrow("User already has this achievement.");

        expect(
            await ds.getRepository(UserLevel).findOneByOrFail({ userId: user }),
        ).toEqual(before);
        expect(await intentsOf(user, definition.id)).toHaveLength(1);
    });

    it("backfill grants silently and a reprocessed batch duplicates nothing", async () => {
        const game = await f.game();
        const users = await Promise.all([f.user(), f.user()]);
        for (const user of users) await f.review(user, game);
        const late = await f.user();
        const definition = await f.definition(
            "reviews_written",
            { gameIds: [game] },
            [[1, 25]],
        );

        expect(await service.backfill(definition.id, null)).toBeNull();
        expect(await service.backfill(definition.id, null)).toBeNull();

        for (const user of users) {
            expect(await tiersOf(user, definition.id)).toEqual([1]);
            expect(await intentsOf(user, definition.id)).toHaveLength(0);
            expect(await progressOf(user, definition.id)).toBe(1);
        }
        expect(await tiersOf(late, definition.id)).toEqual([]);
        expect(await countOf(definition.id, 1)).toBe(2);
        expect(activities.register).not.toHaveBeenCalled();

        await ds
            .getRepository(AchievementDefinition)
            .update(
                { id: definition.id },
                { status: AchievementStatus.ARCHIVED },
            );
        expect(await service.backfill(definition.id, null)).toBeNull();
    });
});
