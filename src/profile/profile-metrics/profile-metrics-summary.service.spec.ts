import { HttpStatus } from "@nestjs/common";
import { Period } from "../../utils/period";
import { ProfileMetricsSummaryService } from "./profile-metrics-summary.service";

// The real services pull in better-auth (ESM) through billing; they are only
// used as injection tokens here, and every dependency is replaced below.
jest.mock("./profile-metrics-report.service", () => ({
    ProfileMetricsReportService: class ProfileMetricsReportService {},
}));
jest.mock("../../game/game-repository/game-repository.service", () => ({
    GameRepositoryService: class GameRepositoryService {},
}));
jest.mock("../../playtime/playtime-history.service", () => ({
    PlaytimeHistoryService: class PlaytimeHistoryService {},
}));

jest.mock("../../playtime/playtime.service", () => ({
    PlaytimeService: class PlaytimeService {},
}));

import { setCacheManager } from "../../utils/cacheable";

// Every call is a cache miss, so the decorator runs the real method.
beforeAll(() => {
    setCacheManager({
        get: async () => undefined,
        set: async () => undefined,
    } as never);
});

type Row = {
    gameId: number;
    source: string;
    platformId: number;
    totalPlaytimeInPeriodSeconds: number;
};

const row = (gameId: number, platformId: number, seconds: number): Row => ({
    gameId,
    source: "steam",
    platformId,
    totalPlaytimeInPeriodSeconds: seconds,
});

type GenreRow = {
    gameId: number;
    genreId: number;
    genreName: string | null;
};

function fixture(options: {
    current: Row[];
    previous?: Row[];
    genres?: GenreRow[];
    played?: unknown[];
}) {
    const getTotalPlaytimeForPeriod = jest
        .fn()
        .mockResolvedValueOnce(options.current)
        .mockResolvedValueOnce(options.previous ?? []);
    const findGameGenresByIds = jest.fn(async () => options.genres ?? []);
    const getGamePlatformsMap = jest.fn(
        async () =>
            new Map([
                [6, { id: 6, name: "PC (Microsoft Windows)" }],
                [48, { id: 48, name: "PlayStation 4" }],
            ]),
    );
    const getActivityCountsSince = jest.fn(async () => ({
        reviewed: 2,
        finished: 1,
        played: 4,
    }));

    const service = new ProfileMetricsSummaryService(
        { getTotalPlaytimeForPeriod } as never,
        { findGameGenresByIds, getGamePlatformsMap } as never,
        { getActivityCountsSince } as never,
        { findPlayedSince: jest.fn(async () => options.played ?? []) } as never,
    );

    return {
        service,
        getTotalPlaytimeForPeriod,
        findGameGenresByIds,
        getActivityCountsSince,
    };
}

describe("ProfileMetricsSummaryService", () => {
    it("sums the windows and ranks games, platform and genre", async () => {
        const { service, findGameGenresByIds } = fixture({
            current: [
                row(1, 6, 7200),
                row(1, 48, 3600),
                row(2, 6, 1800),
                row(3, 48, 600),
            ],
            previous: [row(1, 6, 3600)],
            genres: [
                { gameId: 1, genreId: 10, genreName: "RPG" },
                { gameId: 2, genreId: 10, genreName: "RPG" },
                { gameId: 2, genreId: 11, genreName: "Puzzle" },
                { gameId: 3, genreId: 11, genreName: "Puzzle" },
            ],
        });

        const summary = await service.generateSummary("user-1", Period.WEEK);

        expect(findGameGenresByIds).toHaveBeenCalledWith([1, 2, 3]);
        expect(summary.current).toEqual({
            totalPlaytimeSeconds: 13200,
            totalGames: 3,
        });
        expect(summary.previous).toEqual({
            totalPlaytimeSeconds: 3600,
            totalGames: 1,
        });
        // Game 1 is played on two platforms, and the seconds are summed.
        expect(summary.topGames).toEqual([
            { gameId: 1, totalPlaytimeSeconds: 10800 },
            { gameId: 2, totalPlaytimeSeconds: 1800 },
            { gameId: 3, totalPlaytimeSeconds: 600 },
        ]);
        expect(summary.topPlatform).toEqual({
            id: 6,
            name: "PC (Microsoft Windows)",
            totalPlaytimeSeconds: 9000,
        });
        // RPG: games 1 and 2 (12600s). Puzzle: games 2 and 3 (2400s).
        expect(summary.topGenre).toEqual({
            id: 10,
            name: "RPG",
            totalPlaytimeSeconds: 12600,
        });
        expect(summary).toMatchObject({
            period: Period.WEEK,
            playedInPeriod: 4,
            finishedInPeriod: 1,
            reviewedInPeriod: 2,
        });
    });

    it("tops up games imported before the history from the cumulative rows", async () => {
        const played = (
            gameId: number,
            source: string,
            platformId: number,
            total: number,
            recent: number,
        ) => ({
            gameId,
            source,
            platformId,
            totalPlaytimeSeconds: total,
            recentPlaytimeSeconds: recent,
        });
        // Game 1 (Switch) only has 60s of history growth.
        const options = {
            current: [{ ...row(1, 130, 60), source: "nswitch" }],
            played: [
                played(1, "nswitch", 130, 44 * 3600, 60),
                played(2, "steam", 6, 100 * 3600, 3600),
            ],
        };

        const year = await fixture(options).service.generateSummary(
            "user-1",
            Period.YEAR,
        );
        expect(year.topGames).toEqual([
            { gameId: 2, totalPlaytimeSeconds: 100 * 3600 },
            { gameId: 1, totalPlaytimeSeconds: 44 * 3600 },
        ]);
        expect(year.current.totalGames).toBe(2);

        const month = await fixture(options).service.generateSummary(
            "user-2",
            Period.MONTH,
        );
        // A month only gets the recent playtime, never the lifetime total.
        expect(month.topGames).toEqual([
            { gameId: 2, totalPlaytimeSeconds: 3600 },
            { gameId: 1, totalPlaytimeSeconds: 60 },
        ]);
    });

    it("limits the top games to five", async () => {
        const rows = Array.from({ length: 8 }, (_, index) =>
            row(index + 1, 6, (index + 1) * 100),
        );
        const { service } = fixture({ current: rows, genres: [] });

        const summary = await service.generateSummary("user-1", Period.MONTH);

        expect(summary.topGames.map((game) => game.gameId)).toEqual([
            8, 7, 6, 5, 4,
        ]);
    });

    it("returns empty figures when nothing was played", async () => {
        const { service, findGameGenresByIds } = fixture({ current: [] });

        const summary = await service.generateSummary("user-1", Period.YEAR);

        expect(summary.current).toEqual({
            totalPlaytimeSeconds: 0,
            totalGames: 0,
        });
        expect(summary.topGames).toEqual([]);
        expect(summary.topGenre).toBeNull();
        expect(summary.topPlatform).toBeNull();
        expect(findGameGenresByIds).not.toHaveBeenCalled();
    });

    it("has no top genre when none of the games is in the catalog", async () => {
        const { service } = fixture({
            current: [row(1, 6, 100)],
            genres: [],
        });

        const summary = await service.generateSummary("user-1", Period.WEEK);

        expect(summary.topGenre).toBeNull();
        expect(summary.topPlatform?.id).toBe(6);
    });

    it("only counts the genres of played games present in the catalog", async () => {
        const { service } = fixture({
            current: [row(1, 6, 100), row(2, 6, 50)],
            genres: [{ gameId: 2, genreId: 10, genreName: "RPG" }],
        });

        const summary = await service.generateSummary("user-1", Period.WEEK);

        expect(summary.topGenre).toEqual({
            id: 10,
            name: "RPG",
            totalPlaytimeSeconds: 50,
        });
    });

    it("breaks genre ties by id", async () => {
        const { service } = fixture({
            current: [row(1, 6, 100), row(2, 6, 100)],
            genres: [
                { gameId: 1, genreId: 11, genreName: "Puzzle" },
                { gameId: 2, genreId: 10, genreName: "RPG" },
            ],
        });

        const summary = await service.generateSummary("user-1", Period.WEEK);

        expect(summary.topGenre).toEqual({
            id: 10,
            name: "RPG",
            totalPlaytimeSeconds: 100,
        });
    });

    it("uses rolling windows with the previous one ending where the current starts", async () => {
        const { service, getTotalPlaytimeForPeriod } = fixture({
            current: [],
        });

        await service.generateSummary("user-1", Period.MONTH);

        const [current, previous] = getTotalPlaytimeForPeriod.mock.calls.map(
            ([dto]) => dto,
        );
        const days = (from: Date, to: Date) =>
            Math.round((to.getTime() - from.getTime()) / 86_400_000);
        expect(days(current.startDate, current.endDate)).toBe(30);
        expect(days(previous.startDate, previous.endDate)).toBe(30);
        expect(previous.endDate).toEqual(current.startDate);
    });

    it("rejects periods other than week, month and year", async () => {
        const { service } = fixture({ current: [] });

        await expect(
            service.generateSummary("user-1", Period.DAY as never),
        ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
});
