import { HttpStatus } from "@nestjs/common";
import { Period } from "../../utils/period";
import { ProfileMetricsSummaryService } from "./profile-metrics-summary.service";
import {
    LibraryAudience,
    LIBRARY_VISIBILITY_LEVELS,
    LibraryVisibility,
} from "../../libraries/library-visibility.constants";
import { LibraryAudienceKey } from "./library-audience-key";

const OWNER_AUDIENCE: LibraryAudienceKey = {
    audience: LibraryAudience.Owner,
    visibleEntryLevels: [...LIBRARY_VISIBILITY_LEVELS],
    hiddenFingerprint: "none",
};

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
    estimatedPlaytimeSeconds?: number;
};

const row = (
    gameId: number,
    platformId: number,
    seconds: number,
    estimatedPlaytimeSeconds?: number,
): Row => ({
    gameId,
    source: "steam",
    platformId,
    totalPlaytimeInPeriodSeconds: seconds,
    estimatedPlaytimeSeconds,
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
    hiddenGameIds?: number[];
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
    const hiddenGameIds = jest.fn(async () => options.hiddenGameIds ?? []);

    const service = new ProfileMetricsSummaryService(
        { getTotalPlaytimeForPeriod } as never,
        { findGameGenresByIds, getGamePlatformsMap } as never,
        { getActivityCountsSince } as never,
        { hiddenGameIds } as never,
    );

    return {
        service,
        getTotalPlaytimeForPeriod,
        findGameGenresByIds,
        getActivityCountsSince,
        hiddenGameIds,
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

        const summary = await service.generateSummary(
            "user-1",
            Period.WEEK,
            OWNER_AUDIENCE,
        );

        expect(findGameGenresByIds).toHaveBeenCalledWith([1, 2, 3]);
        expect(summary.current).toEqual({
            totalPlaytimeSeconds: 13200,
            estimatedPlaytimeSeconds: 0,
            totalGames: 3,
        });
        expect(summary.previous).toEqual({
            totalPlaytimeSeconds: 3600,
            estimatedPlaytimeSeconds: 0,
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

    it("separates the first Steam observation estimate per window", async () => {
        const { service } = fixture({
            current: [row(1, 6, 1200, 200)],
            previous: [row(1, 6, 900, 700)],
        });

        const summary = await service.generateSummary(
            "user-1",
            Period.WEEK,
            OWNER_AUDIENCE,
        );

        expect(summary.current).toEqual({
            totalPlaytimeSeconds: 1200,
            estimatedPlaytimeSeconds: 200,
            totalGames: 1,
        });
        expect(summary.previous).toEqual({
            totalPlaytimeSeconds: 900,
            estimatedPlaytimeSeconds: 700,
            totalGames: 1,
        });
    });

    it("limits the top games to five", async () => {
        const rows = Array.from({ length: 8 }, (_, index) =>
            row(index + 1, 6, (index + 1) * 100),
        );
        const { service } = fixture({ current: rows, genres: [] });

        const summary = await service.generateSummary(
            "user-1",
            Period.MONTH,
            OWNER_AUDIENCE,
        );

        expect(summary.topGames.map((game) => game.gameId)).toEqual([
            8, 7, 6, 5, 4,
        ]);
    });

    it("returns empty figures when nothing was played", async () => {
        const { service, findGameGenresByIds } = fixture({ current: [] });

        const summary = await service.generateSummary(
            "user-1",
            Period.YEAR,
            OWNER_AUDIENCE,
        );

        expect(summary.current).toEqual({
            totalPlaytimeSeconds: 0,
            estimatedPlaytimeSeconds: 0,
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

        const summary = await service.generateSummary(
            "user-1",
            Period.WEEK,
            OWNER_AUDIENCE,
        );

        expect(summary.topGenre).toBeNull();
        expect(summary.topPlatform?.id).toBe(6);
    });

    it("only counts the genres of played games present in the catalog", async () => {
        const { service } = fixture({
            current: [row(1, 6, 100), row(2, 6, 50)],
            genres: [{ gameId: 2, genreId: 10, genreName: "RPG" }],
        });

        const summary = await service.generateSummary(
            "user-1",
            Period.WEEK,
            OWNER_AUDIENCE,
        );

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

        const summary = await service.generateSummary(
            "user-1",
            Period.WEEK,
            OWNER_AUDIENCE,
        );

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

        await service.generateSummary("user-1", Period.MONTH, OWNER_AUDIENCE);

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
            service.generateSummary(
                "user-1",
                Period.DAY as never,
                OWNER_AUDIENCE,
            ),
        ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });

    it("excludes hidden games from the windows, rankings and activity counts", async () => {
        const { service, getActivityCountsSince } = fixture({
            current: [row(1, 6, 7200), row(2, 6, 1800)],
            previous: [row(1, 6, 3600), row(2, 6, 900)],
            genres: [
                { gameId: 1, genreId: 10, genreName: "RPG" },
                { gameId: 2, genreId: 11, genreName: "Puzzle" },
            ],
            hiddenGameIds: [1],
        });

        const summary = await service.generateSummary("user-1", Period.WEEK, {
            audience: LibraryAudience.Everyone,
            visibleEntryLevels: [LibraryVisibility.Public],
            hiddenFingerprint: "hidden-game-1",
        });

        expect(summary.current).toEqual({
            totalPlaytimeSeconds: 1800,
            estimatedPlaytimeSeconds: 0,
            totalGames: 1,
        });
        expect(summary.previous).toEqual({
            totalPlaytimeSeconds: 900,
            estimatedPlaytimeSeconds: 0,
            totalGames: 1,
        });
        expect(summary.topGames).toEqual([
            { gameId: 2, totalPlaytimeSeconds: 1800 },
        ]);
        expect(summary.topGenre).toEqual({
            id: 11,
            name: "Puzzle",
            totalPlaytimeSeconds: 1800,
        });
        expect(summary.topPlatform).toEqual({
            id: 6,
            name: "PC (Microsoft Windows)",
            totalPlaytimeSeconds: 1800,
        });
        expect(getActivityCountsSince).toHaveBeenCalledWith(
            "user-1",
            expect.anything(),
            [1],
        );
    });

    it("returns zeros when the library is hidden from the viewer", async () => {
        const { service, getTotalPlaytimeForPeriod, getActivityCountsSince } =
            fixture({ current: [row(1, 6, 7200)] });

        const summary = await service.generateSummary("user-1", Period.WEEK, {
            audience: LibraryAudience.Everyone,
            visibleEntryLevels: [],
            hiddenFingerprint: "all",
        });

        expect(summary).toEqual({
            period: Period.WEEK,
            current: {
                totalPlaytimeSeconds: 0,
                estimatedPlaytimeSeconds: 0,
                totalGames: 0,
            },
            previous: {
                totalPlaytimeSeconds: 0,
                estimatedPlaytimeSeconds: 0,
                totalGames: 0,
            },
            topGames: [],
            topGenre: null,
            topPlatform: null,
            playedInPeriod: 0,
            finishedInPeriod: 0,
            reviewedInPeriod: 0,
        });
        expect(getTotalPlaytimeForPeriod).not.toHaveBeenCalled();
        expect(getActivityCountsSince).not.toHaveBeenCalled();
    });

    it("recomputes when a game is hidden instead of waiting for the TTL", async () => {
        const store = new Map<string, unknown>();
        setCacheManager({
            get: async (key: string) => store.get(key),
            set: async (key: string, value: unknown) => {
                store.set(key, value);
            },
        } as never);

        const { service, getTotalPlaytimeForPeriod, hiddenGameIds } = fixture({
            current: [row(1, 6, 7200), row(2, 6, 1800)],
            previous: [],
        });
        const visibleGame1 = {
            audience: LibraryAudience.Everyone,
            visibleEntryLevels: [LibraryVisibility.Public],
            hiddenFingerprint: "none",
        };

        const before = await service.generateSummary(
            "user-1",
            Period.WEEK,
            visibleGame1,
        );
        expect(before.current.totalGames).toBe(2);

        // The entry becomes private; only the fingerprint of the hidden ids changes.
        hiddenGameIds.mockResolvedValue([1]);
        getTotalPlaytimeForPeriod.mockImplementation(async () => [
            row(2, 6, 1800),
        ]);

        const after = await service.generateSummary("user-1", Period.WEEK, {
            ...visibleGame1,
            hiddenFingerprint: "hidden-game-1",
        });

        expect(after.current).toEqual({
            totalPlaytimeSeconds: 1800,
            estimatedPlaytimeSeconds: 0,
            totalGames: 1,
        });
        // A cache hit would have returned the first value without querying again.
        expect(getTotalPlaytimeForPeriod).toHaveBeenCalledTimes(4);
    });
});
