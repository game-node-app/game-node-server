import {
    deriveBacklogGrowth,
    deriveCalendarHighlights,
    derivePlaytimeByPlatform,
    deriveTopGames,
} from "./recap.utils";

const emptyDays = (year: number) =>
    Array.from(
        {
            length:
                year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
                    ? 366
                    : 365,
        },
        () => 0,
    );

const playedGame = (
    overrides: Partial<{
        gameId: number;
        platformId: number;
        totalPlaytimeSeconds: number;
        firstPlayedAt: string | null;
        finishedAt: Date | null;
        rating: number | null;
    }> = {},
) => ({
    gameId: 1,
    platformId: 1,
    totalPlaytimeSeconds: 0,
    firstPlayedAt: null,
    finishedAt: null,
    rating: null,
    ...overrides,
});

describe("deriveCalendarHighlights", () => {
    it("finds the 2 to 24 March streak", () => {
        const daily = emptyDays(2026);
        for (let day = 60; day <= 82; day++) daily[day] = 60;

        const calendar = deriveCalendarHighlights(daily, 2026);

        expect(calendar?.longestStreak).toEqual({
            start: "2026-03-02",
            end: "2026-03-24",
            days: 23,
        });
        expect(calendar?.monthlyPlaytimeSeconds[2]).toBe(23 * 60);
    });

    it("handles every day of a leap year", () => {
        const daily = emptyDays(2028);
        daily[59] = 10;
        daily[364] = 30;
        daily[365] = 30;

        const calendar = deriveCalendarHighlights(daily, 2028);

        expect(daily).toHaveLength(366);
        expect(calendar?.monthlyPlaytimeSeconds[1]).toBe(10);
        expect(calendar?.monthlyPlaytimeSeconds[11]).toBe(60);
        expect(calendar?.longestStreak).toEqual({
            start: "2028-12-30",
            end: "2028-12-31",
            days: 2,
        });
    });

    it("returns null highlights when there is no playtime", () => {
        const calendar = deriveCalendarHighlights(emptyDays(2026), 2026);

        expect(calendar).toEqual({
            monthlyPlaytimeSeconds: Array.from({ length: 12 }, () => 0),
            topMonth: null,
            longestStreak: null,
            topWeekday: null,
            weekendShare: 0,
        });
    });

    it("returns null for an old Recap without daily data", () => {
        expect(deriveCalendarHighlights(null, 2026)).toBeNull();
    });

    it("picks the top month, weekday and weekend share", () => {
        const daily = emptyDays(2026);
        // Saturday 3 Jan and Sunday 4 Jan 2026.
        daily[2] = 30;
        daily[3] = 10;

        const calendar = deriveCalendarHighlights(daily, 2026);

        expect(calendar?.topMonth).toEqual({
            month: 1,
            playtimeSeconds: 40,
        });
        expect(calendar?.topWeekday).toEqual({ weekday: 6, share: 0.75 });
        expect(calendar?.weekendShare).toBe(1);
    });
});

describe("deriveTopGames", () => {
    it("merges the same game from two sources", () => {
        const topGames = deriveTopGames([
            playedGame({
                gameId: 1,
                platformId: 1,
                totalPlaytimeSeconds: 600,
                firstPlayedAt: "2026-03-02",
                finishedAt: new Date("2026-03-14T00:00:00.000Z"),
                rating: 4.5,
            }),
            playedGame({
                gameId: 1,
                platformId: 2,
                totalPlaytimeSeconds: 400,
            }),
            playedGame({
                gameId: 2,
                platformId: 1,
                totalPlaytimeSeconds: 1000,
                firstPlayedAt: "2026-02-01",
            }),
        ]);

        expect(topGames).toHaveLength(2);
        expect(topGames[0]).toEqual({
            gameId: 1,
            platformIds: [1, 2],
            totalPlaytimeSeconds: 1000,
            share: 0.5,
            firstPlayedAt: "2026-03-02",
            finishedAt: new Date("2026-03-14T00:00:00.000Z"),
            rating: 4.5,
        });
        expect(topGames[1]).toMatchObject({ gameId: 2, share: 0.5 });
    });
});

describe("derivePlaytimeByPlatform", () => {
    it("sums playtime per platform with shares", () => {
        const byPlatform = derivePlaytimeByPlatform([
            playedGame({ platformId: 1, totalPlaytimeSeconds: 600 }),
            playedGame({ platformId: 2, totalPlaytimeSeconds: 400 }),
            playedGame({ platformId: 1, totalPlaytimeSeconds: 1000 }),
        ]);

        expect(byPlatform).toEqual([
            { platform: 1, totalPlaytimeSeconds: 1600, share: 0.8 },
            { platform: 2, totalPlaytimeSeconds: 400, share: 0.2 },
        ]);
    });
});

describe("deriveBacklogGrowth", () => {
    it("is added minus finished minus dropped", () => {
        expect(deriveBacklogGrowth(52, 14, 6)).toBe(32);
    });

    it("floors at zero", () => {
        expect(deriveBacklogGrowth(3, 3, 1)).toBe(0);
    });
});
