import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../../test/notifications/notification-test-harness";
import { achievementFixtures } from "../../../test/achievements/achievement-fixtures";
import {
    ACHIEVEMENT_METRICS,
    validateMetricCriteria,
} from "./achievement-metrics";

const HORROR = 19;
const OCTOBER = {
    startsAt: new Date("2026-10-01T00:00:00Z"),
    endsAt: new Date("2026-11-01T00:00:00Z"),
};
const inOctober = new Date("2026-10-15T00:00:00Z");
const inSeptember = new Date("2026-09-15T00:00:00Z");

describe("achievement metrics (integration)", () => {
    let ds: DataSource;
    let f: ReturnType<typeof achievementFixtures>;
    const compute = (
        key: string,
        userId: string,
        criteria: object = {},
        window: any = null,
    ) =>
        ACHIEVEMENT_METRICS.get(key)!.compute(
            ds.manager,
            userId,
            criteria,
            window,
        );

    beforeAll(async () => {
        ds = await createNotificationTestDataSource();
        f = achievementFixtures(ds);
    });

    afterAll(() => ds?.destroy());

    it("reviews_written counts with and without filters and window", async () => {
        const user = await f.user();
        const horror = await f.game([HORROR]);
        const other = await f.game([], [5]);
        await f.review(user, horror, inOctober);
        await f.review(user, other, inSeptember);

        expect(await compute("reviews_written", user)).toBe(2);
        expect(
            await compute("reviews_written", user, { themeIds: [HORROR] }),
        ).toBe(1);
        expect(await compute("reviews_written", user, { genreIds: [5] })).toBe(
            1,
        );
        expect(
            await compute("reviews_written", user, { gameIds: [other] }),
        ).toBe(1);
        expect(await compute("reviews_written", user, {}, OCTOBER)).toBe(1);
    });

    it("library_games counts distinct games and games_finished counts finishes in the window", async () => {
        const user = await f.user();
        const a = await f.game([HORROR]);
        const b = await f.game([HORROR]);
        const c = await f.game();
        await f.entry(user, a, inSeptember, inOctober);
        await f.entry(user, b, inOctober, inOctober);
        await f.entry(user, c, inOctober, inSeptember);

        expect(await compute("library_games", user)).toBe(3);
        expect(
            await compute("library_games", user, { themeIds: [HORROR] }),
        ).toBe(2);
        expect(await compute("library_games", user, {}, OCTOBER)).toBe(2);
        expect(await compute("games_finished", user)).toBe(3);
        // 2 horror games finished in october, 1 in september: progress is 2
        expect(
            await compute(
                "games_finished",
                user,
                { themeIds: [HORROR] },
                OCTOBER,
            ),
        ).toBe(2);
        expect(await compute("games_finished", user, {}, OCTOBER)).toBe(2);
    });

    it("followers, comments_written and awards_participation", async () => {
        const user = await f.user();
        const other = await f.user();
        await f.follow(other, user, inOctober);
        await f.follow(await f.user(), user, inSeptember);
        const review = await f.review(other, await f.game());
        await f.reviewComment(user, review, inOctober);
        await f.reviewComment(user, review, inSeptember);
        await f.awardsVote(user, 2025);

        expect(await compute("followers", user)).toBe(2);
        expect(await compute("followers", user, {}, OCTOBER)).toBe(1);
        expect(await compute("comments_written", user)).toBe(2);
        expect(await compute("comments_written", user, {}, OCTOBER)).toBe(1);
        expect(
            await compute("awards_participation", user, { year: 2025 }),
        ).toBe(1);
        expect(
            await compute("awards_participation", user, { year: 2024 }),
        ).toBe(0);
        expect(
            await compute("awards_participation", other, { year: 2025 }),
        ).toBe(0);
        expect(await compute("manual", user)).toBe(0);
    });

    it("candidates pages by userId and respects filters and window", async () => {
        const game = await f.game();
        const users = await Promise.all([f.user(), f.user(), f.user()]);
        for (const user of users) await f.review(user, game, inOctober);
        const late = await f.user();
        await f.review(late, game, inSeptember);
        const metric = ACHIEVEMENT_METRICS.get("reviews_written")!;
        const criteria = { gameIds: [game] };

        const first = await metric.candidates(
            ds.manager,
            criteria,
            OCTOBER,
            null,
            2,
        );
        const second = await metric.candidates(
            ds.manager,
            criteria,
            OCTOBER,
            first[1],
            2,
        );

        expect([...first, ...second]).toEqual([...users].sort());
        expect(
            await metric.candidates(ds.manager, criteria, null, null, 10),
        ).toEqual([...users, late].sort());
        expect(
            await ACHIEVEMENT_METRICS.get("manual")!.candidates(
                ds.manager,
                {},
                null,
                null,
                10,
            ),
        ).toEqual([]);
    });

    it("validates criteria against the metric filters", () => {
        const followers = ACHIEVEMENT_METRICS.get("followers")!;
        const reviews = ACHIEVEMENT_METRICS.get("reviews_written")!;
        const awards = ACHIEVEMENT_METRICS.get("awards_participation")!;
        expect(validateMetricCriteria(followers, {})).toEqual([]);
        expect(
            validateMetricCriteria(followers, { themeIds: [1] }).join(),
        ).toContain("themeIds");
        expect(
            validateMetricCriteria(reviews, { themeIds: [19], gameIds: [1] }),
        ).toEqual([]);
        expect(
            validateMetricCriteria(reviews, { themeIds: Array(51).fill(1) }),
        ).not.toEqual([]);
        expect(validateMetricCriteria(awards, {})).not.toEqual([]);
        expect(validateMetricCriteria(reviews, [])).not.toEqual([]);
        expect(awards.supportsWindow).toBe(false);
        expect(reviews.supportsWindow).toBe(true);
    });
});
