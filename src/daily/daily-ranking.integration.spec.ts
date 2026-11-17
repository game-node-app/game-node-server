import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyResult } from "./entity/daily-result.entity";
import { DailyRankingEntry } from "./entity/daily-ranking-entry.entity";
import { DailyRankingService } from "./daily-ranking.service";
import { DailyService } from "./daily.service";
import {
    addDays,
    dailyToday,
    DailyMode,
    DailyStatus,
    mondayOf,
} from "./daily.constants";
import { computeStreaks } from "./daily-ranking.utils";

// Fixture puzzles use numbers from here up, so a rerun can clean them without touching anything else.
const FIXTURE_NUMBER = 950_000;
// Wednesday: the week starts on 2026-03-02 and the month on 2026-03-01.
const TODAY = "2026-03-04";
const ANSWER_ID = 1;

interface ExpectedRow {
    period: "today" | "week" | "month" | "all";
    periodStart: string;
    mode: DailyMode | "overall";
    points: number;
    coverPoints: number;
    artworkPoints: number;
    keywordsPoints: number;
    specsPoints: number;
    wins: number;
    played: number;
    winAttempts: number;
    prevPoints: number;
    prevPlayed: number;
    prevWinAttempts: number;
    prevLastFinishedAt: string | null;
    lastFinishedAt: string;
    streak?: number;
    streakEnd?: string | null;
    bestStreak?: number;
}

describe("DailyRankingService writes on MySQL", () => {
    jest.setTimeout(120000);

    let dataSource: DataSource;
    let service: DailyRankingService;
    let dailyService: DailyService;
    let fixtureCount = 0;
    const users: string[] = [];
    const cache = new Map<string, unknown>();

    const cleanup = async () => {
        await dataSource.query("DELETE FROM daily_puzzle WHERE number >= ?", [
            FIXTURE_NUMBER,
        ]);
        if (users.length)
            await dataSource.query(
                `DELETE FROM profile WHERE userId IN (${users
                    .map(() => "?")
                    .join(",")})`,
                users,
            );
        users.length = 0;
        fixtureCount = 0;
    };

    const createPuzzle = (
        date: string,
        mode = DailyMode.COVER,
        kind: "daily" | "weekly" = "daily",
    ) =>
        dataSource.getRepository(DailyPuzzle).save({
            kind,
            mode,
            number: FIXTURE_NUMBER + ++fixtureCount,
            date,
            gameId: ANSWER_ID,
            meta: {},
            source: "admin" as const,
        });

    // One row per kind/mode/date: tests share the fixture puzzle instead of colliding on the unique key.
    const puzzles = new Map<string, Promise<DailyPuzzle>>();
    const puzzle = (
        date: string,
        mode = DailyMode.COVER,
        kind: "daily" | "weekly" = "daily",
    ) => {
        const key = `${kind}:${mode}:${date}`;
        if (!puzzles.has(key)) puzzles.set(key, createPuzzle(date, mode, kind));
        return puzzles.get(key)!;
    };

    const createUser = async (): Promise<string> => {
        const userId = randomUUID();
        await dataSource.query(
            "INSERT INTO profile (userId, username) VALUES (?, ?)",
            [userId, `rank_${userId.slice(0, 8)}`],
        );
        users.push(userId);
        return userId;
    };

    const addResult = (
        userId: string,
        fixture: DailyPuzzle,
        {
            status = DailyStatus.WON,
            points = 0,
            attempts = 1,
            ranked = 1,
            finishedAt,
        }: {
            status?: DailyStatus;
            points?: number;
            attempts?: number;
            ranked?: number;
            finishedAt?: string | null;
        } = {},
    ) =>
        dataSource.query(
            `INSERT INTO daily_result
                 (userId, puzzleId, guesses, hintAt, status, ranked, points, attempts, finishedAt)
             VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
            [
                userId,
                fixture.id,
                "[]",
                status,
                ranked,
                points,
                attempts,
                finishedAt === undefined
                    ? `${fixture.date} 12:00:00`
                    : finishedAt,
            ],
        );

    const rowsFor = async (userId: string) =>
        (
            await dataSource.getRepository(DailyRankingEntry).findBy({ userId })
        ).sort(
            (a, b) =>
                a.period.localeCompare(b.period) ||
                a.periodStart.localeCompare(b.periodStart) ||
                a.mode.localeCompare(b.mode),
        );

    const byKey = (rows: DailyRankingEntry[]) =>
        new Map(rows.map((row) => [`${row.period}:${row.mode}`, row]));

    const expectRows = async (userId: string, expected: ExpectedRow[]) => {
        const actual = byKey(await rowsFor(userId));
        expect(actual.size).toBe(expected.length);
        for (const expectedRow of expected) {
            const row = actual.get(`${expectedRow.period}:${expectedRow.mode}`);
            expect(row).toBeDefined();
            expect(row).toMatchObject({
                period: expectedRow.period,
                periodStart: expectedRow.periodStart,
                mode: expectedRow.mode,
                userId,
                points: expectedRow.points,
                coverPoints: expectedRow.coverPoints,
                artworkPoints: expectedRow.artworkPoints,
                keywordsPoints: expectedRow.keywordsPoints,
                specsPoints: expectedRow.specsPoints,
                wins: expectedRow.wins,
                played: expectedRow.played,
                winAttempts: expectedRow.winAttempts,
                prevPoints: expectedRow.prevPoints,
                prevPlayed: expectedRow.prevPlayed,
                prevWinAttempts: expectedRow.prevWinAttempts,
                asOf: TODAY,
                streak: expectedRow.streak ?? 0,
                streakEnd: expectedRow.streakEnd ?? null,
                bestStreak: expectedRow.bestStreak ?? 0,
            });
            expect(row!.lastFinishedAt.toISOString()).toBe(
                `${expectedRow.lastFinishedAt}T12:00:00.000Z`,
            );
            expect(row!.prevLastFinishedAt?.toISOString() ?? null).toBe(
                expectedRow.prevLastFinishedAt === null
                    ? null
                    : `${expectedRow.prevLastFinishedAt}T12:00:00.000Z`,
            );
        }
    };

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await cleanup();
        const cacheMock = {
            get: async (key: string) => cache.get(key),
            set: async (key: string, value: unknown) => {
                cache.set(key, value);
            },
        };
        const auth = { getLockedUserIds: async () => [] };
        const billing = { findSupporterUserIds: async () => [] };
        service = new DailyRankingService(
            dataSource,
            auth as any,
            cacheMock as any,
            billing as any,
        );
        dailyService = new DailyService(
            dataSource.getRepository(DailyPuzzle),
            dataSource.getRepository(DailyResult),
            dataSource,
            cacheMock as any,
            { getOrThrow: () => "integration-secret" } as any,
            service,
        );
    });

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await cleanup();
            await dataSource.destroy();
        }
    });

    it("writes one absolute aggregate per partition, ignoring unranked and weekly rows", async () => {
        const userId = await createUser();
        const rows: [string, DailyMode, number, number][] = [
            ["2026-02-28", DailyMode.COVER, 10, 1],
            ["2026-03-01", DailyMode.ARTWORK, 20, 2],
            ["2026-03-02", DailyMode.KEYWORDS, 30, 3],
            ["2026-03-03", DailyMode.COVER, 60, 1],
            ["2026-03-03", DailyMode.ARTWORK, 50, 2],
            ["2026-03-03", DailyMode.KEYWORDS, 40, 3],
            ["2026-03-03", DailyMode.SPECS, 24, 7],
            [TODAY, DailyMode.COVER, 30, 4],
        ];
        for (const [date, mode, points, attempts] of rows)
            await addResult(userId, await puzzle(date, mode), {
                points,
                attempts,
            });
        // A counted loss still counts as played, with 0 points and no win attempts.
        await addResult(userId, await puzzle(TODAY, DailyMode.ARTWORK), {
            status: DailyStatus.LOST,
            attempts: 6,
        });
        // Imported and practice rows never reach the table; this one is simply not ranked.
        await addResult(userId, await puzzle(TODAY, DailyMode.KEYWORDS), {
            points: 90,
            ranked: 0,
        });
        // Weekly results are ranked for their own friends ranking but never score here.
        await addResult(
            userId,
            await puzzle(TODAY, DailyMode.SPECS, "weekly"),
            {
                points: 100,
            },
        );

        await service.recompute(userId, TODAY);

        const week = mondayOf(TODAY);
        const month = `${TODAY.slice(0, 8)}01`;
        await expectRows(userId, [
            {
                period: "today",
                periodStart: TODAY,
                mode: "overall",
                points: 30,
                coverPoints: 30,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 1,
                played: 2,
                winAttempts: 4,
                prevPoints: 0,
                prevPlayed: 0,
                prevWinAttempts: 0,
                prevLastFinishedAt: null,
                lastFinishedAt: TODAY,
            },
            {
                period: "today",
                periodStart: TODAY,
                mode: DailyMode.COVER,
                points: 30,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 1,
                played: 1,
                winAttempts: 4,
                prevPoints: 0,
                prevPlayed: 0,
                prevWinAttempts: 0,
                prevLastFinishedAt: null,
                lastFinishedAt: TODAY,
            },
            {
                period: "today",
                periodStart: TODAY,
                mode: DailyMode.ARTWORK,
                points: 0,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 0,
                played: 1,
                winAttempts: 0,
                prevPoints: 0,
                prevPlayed: 0,
                prevWinAttempts: 0,
                prevLastFinishedAt: null,
                lastFinishedAt: TODAY,
            },
            {
                period: "week",
                periodStart: week,
                mode: "overall",
                points: 254,
                coverPoints: 90,
                artworkPoints: 50,
                keywordsPoints: 70,
                specsPoints: 24,
                wins: 6,
                played: 7,
                winAttempts: 20,
                prevPoints: 224,
                prevPlayed: 5,
                prevWinAttempts: 16,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
            },
            {
                period: "week",
                periodStart: week,
                mode: DailyMode.COVER,
                points: 90,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 2,
                played: 2,
                winAttempts: 5,
                prevPoints: 60,
                prevPlayed: 1,
                prevWinAttempts: 1,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
            },
            {
                period: "week",
                periodStart: week,
                mode: DailyMode.ARTWORK,
                points: 50,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 1,
                played: 2,
                winAttempts: 2,
                prevPoints: 50,
                prevPlayed: 1,
                prevWinAttempts: 2,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
            },
            {
                period: "week",
                periodStart: week,
                mode: DailyMode.KEYWORDS,
                points: 70,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 2,
                played: 2,
                winAttempts: 6,
                prevPoints: 70,
                prevPlayed: 2,
                prevWinAttempts: 6,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: "2026-03-03",
            },
            {
                period: "week",
                periodStart: week,
                mode: DailyMode.SPECS,
                points: 24,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 1,
                played: 1,
                winAttempts: 7,
                prevPoints: 24,
                prevPlayed: 1,
                prevWinAttempts: 7,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: "2026-03-03",
            },
            {
                period: "month",
                periodStart: month,
                mode: "overall",
                points: 274,
                coverPoints: 90,
                artworkPoints: 70,
                keywordsPoints: 70,
                specsPoints: 24,
                wins: 7,
                played: 8,
                winAttempts: 22,
                prevPoints: 244,
                prevPlayed: 6,
                prevWinAttempts: 18,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
            },
            {
                period: "month",
                periodStart: month,
                mode: DailyMode.COVER,
                points: 90,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 2,
                played: 2,
                winAttempts: 5,
                prevPoints: 60,
                prevPlayed: 1,
                prevWinAttempts: 1,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
            },
            {
                period: "month",
                periodStart: month,
                mode: DailyMode.ARTWORK,
                points: 70,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 2,
                played: 3,
                winAttempts: 4,
                prevPoints: 70,
                prevPlayed: 2,
                prevWinAttempts: 4,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
            },
            {
                period: "month",
                periodStart: month,
                mode: DailyMode.KEYWORDS,
                points: 70,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 2,
                played: 2,
                winAttempts: 6,
                prevPoints: 70,
                prevPlayed: 2,
                prevWinAttempts: 6,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: "2026-03-03",
            },
            {
                period: "month",
                periodStart: month,
                mode: DailyMode.SPECS,
                points: 24,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 1,
                played: 1,
                winAttempts: 7,
                prevPoints: 24,
                prevPlayed: 1,
                prevWinAttempts: 7,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: "2026-03-03",
            },
            {
                period: "all",
                periodStart: "2000-01-01",
                mode: "overall",
                points: 284,
                coverPoints: 100,
                artworkPoints: 70,
                keywordsPoints: 70,
                specsPoints: 24,
                wins: 8,
                played: 9,
                winAttempts: 23,
                prevPoints: 254,
                prevPlayed: 7,
                prevWinAttempts: 19,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
                streak: 5,
                streakEnd: TODAY,
            },
            {
                period: "all",
                periodStart: "2000-01-01",
                mode: DailyMode.COVER,
                points: 100,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 3,
                played: 3,
                winAttempts: 6,
                prevPoints: 70,
                prevPlayed: 2,
                prevWinAttempts: 2,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
                bestStreak: 2,
            },
            {
                period: "all",
                periodStart: "2000-01-01",
                mode: DailyMode.ARTWORK,
                points: 70,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 2,
                played: 3,
                winAttempts: 4,
                prevPoints: 70,
                prevPlayed: 2,
                prevWinAttempts: 4,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: TODAY,
                bestStreak: 1,
            },
            {
                period: "all",
                periodStart: "2000-01-01",
                mode: DailyMode.KEYWORDS,
                points: 70,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 2,
                played: 2,
                winAttempts: 6,
                prevPoints: 70,
                prevPlayed: 2,
                prevWinAttempts: 6,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: "2026-03-03",
                bestStreak: 2,
            },
            {
                period: "all",
                periodStart: "2000-01-01",
                mode: DailyMode.SPECS,
                points: 24,
                coverPoints: 0,
                artworkPoints: 0,
                keywordsPoints: 0,
                specsPoints: 0,
                wins: 1,
                played: 1,
                winAttempts: 7,
                prevPoints: 24,
                prevPlayed: 1,
                prevWinAttempts: 7,
                prevLastFinishedAt: "2026-03-03",
                lastFinishedAt: "2026-03-03",
                bestStreak: 1,
            },
        ]);

        // The stored streak columns are the run ending at the latest win, per `computeStreaks`.
        const streaks = computeStreaks(
            [
                ["2026-02-28", DailyMode.COVER],
                ["2026-03-01", DailyMode.ARTWORK],
                ["2026-03-02", DailyMode.KEYWORDS],
                ["2026-03-03", DailyMode.COVER],
                ["2026-03-03", DailyMode.ARTWORK],
                ["2026-03-03", DailyMode.KEYWORDS],
                ["2026-03-03", DailyMode.SPECS],
                [TODAY, DailyMode.COVER],
            ].map(([date, mode]) => ({
                date: date as string,
                mode: mode as DailyMode,
            })),
            TODAY,
        );
        const all = byKey(await rowsFor(userId)).get("all:overall")!;
        expect(all.streak).toBe(streaks.current);
        expect(all.streakEnd).toBe(TODAY);
        expect(byKey(await rowsFor(userId)).get("all:cover")!.bestStreak).toBe(
            streaks.best[DailyMode.COVER],
        );
    });

    it("adds the bonus only when all four modes were won, never to a mode row", async () => {
        const allFour = await createUser();
        const three = await createUser();
        for (const [mode, points, attempts] of [
            [DailyMode.COVER, 60, 1],
            [DailyMode.ARTWORK, 50, 2],
            [DailyMode.KEYWORDS, 40, 3],
            [DailyMode.SPECS, 24, 7],
        ] as const) {
            await addResult(allFour, await puzzle(TODAY, mode), {
                points,
                attempts,
            });
            await addResult(three, await puzzle(TODAY, mode), {
                status:
                    mode === DailyMode.SPECS
                        ? DailyStatus.LOST
                        : DailyStatus.WON,
                points: mode === DailyMode.SPECS ? 0 : points,
                attempts,
            });
        }

        await service.recompute(allFour, TODAY);
        await service.recompute(three, TODAY);

        const allFourRows = byKey(await rowsFor(allFour));
        expect(allFourRows.get("today:overall")!.points).toBe(
            60 + 50 + 40 + 24 + 20,
        );
        expect(allFourRows.get("today:specs")!.points).toBe(24);

        const threeRows = byKey(await rowsFor(three));
        expect(threeRows.get("today:overall")!.points).toBe(60 + 50 + 40);
        expect(threeRows.get("today:specs")!.points).toBe(0);
        expect(threeRows.get("today:specs")!.wins).toBe(0);
        expect(threeRows.get("today:specs")!.played).toBe(1);
    });

    it("writes the same rows when the same player is recomputed again", async () => {
        const userId = await createUser();
        await addResult(userId, await puzzle(TODAY), { points: 60 });
        await addResult(userId, await puzzle("2026-03-03"), { points: 30 });

        await service.recompute(userId, TODAY);
        const first = await rowsFor(userId);
        await service.recompute(userId, TODAY);

        expect(await rowsFor(userId)).toEqual(first);
    });

    it("rebuilds what the per-player recomputes wrote", async () => {
        const first = await createUser();
        const second = await createUser();
        await addResult(first, await puzzle(TODAY, DailyMode.KEYWORDS), {
            points: 60,
            attempts: 1,
        });
        await addResult(first, await puzzle("2026-03-02"), {
            points: 20,
            attempts: 2,
        });
        await addResult(second, await puzzle("2026-03-03", DailyMode.SPECS), {
            points: 24,
            attempts: 7,
        });
        await addResult(second, await puzzle(TODAY), {
            status: DailyStatus.LOST,
            attempts: 6,
        });
        await service.recompute(first, TODAY);
        await service.recompute(second, TODAY);

        const expected = [
            ...(await rowsFor(first)),
            ...(await rowsFor(second)),
        ];
        await dataSource.query(
            `DELETE FROM daily_ranking_entry WHERE userId IN (?, ?)`,
            [first, second],
        );

        await expect(service.rebuild(TODAY)).resolves.toBeGreaterThanOrEqual(2);

        const rebuilt = [...(await rowsFor(first)), ...(await rowsFor(second))];
        expect(rebuilt).toEqual(expected);
    });

    it("deletes the entries of a deleted profile", async () => {
        const userId = await createUser();
        await addResult(userId, await puzzle(TODAY), { points: 60 });
        await service.recompute(userId, TODAY);
        expect(await rowsFor(userId)).not.toHaveLength(0);

        await dataSource.query("DELETE FROM profile WHERE userId = ?", [
            userId,
        ]);
        expect(await rowsFor(userId)).toEqual([]);
    });

    it("counts two concurrent finishes by one player in different modes", async () => {
        const userId = await createUser();
        const today = dailyToday();
        const cover = await puzzle(today, DailyMode.COVER);
        const artwork = await puzzle(today, DailyMode.ARTWORK);

        const [first, second] = await Promise.all([
            dailyService.play(userId, cover.id, { guesses: [ANSWER_ID] }),
            dailyService.play(userId, artwork.id, { guesses: [ANSWER_ID] }),
        ]);
        expect(first.status).toBe(DailyStatus.WON);
        expect(second.status).toBe(DailyStatus.WON);

        const rows = byKey(await rowsFor(userId));
        expect(rows.get("today:overall")).toMatchObject({
            points: 120,
            wins: 2,
            played: 2,
            coverPoints: 60,
            artworkPoints: 60,
        });
        expect(rows.get("today:cover")).toMatchObject({ points: 60 });
        expect(rows.get("today:artwork")).toMatchObject({ points: 60 });
        expect(
            await dataSource
                .getRepository(DailyResult)
                .countBy({ userId, ranked: true }),
        ).toBe(2);
    });

    it("counts a puzzle finished twice at the same time once", async () => {
        const userId = await createUser();
        const keywords = await puzzle(dailyToday(), DailyMode.KEYWORDS);

        const [first, second] = await Promise.all([
            dailyService.play(userId, keywords.id, { guesses: [ANSWER_ID] }),
            dailyService.play(userId, keywords.id, { guesses: [ANSWER_ID] }),
        ]);
        expect(first.status).toBe(DailyStatus.WON);
        expect(second.status).toBe(DailyStatus.WON);

        const rows = byKey(await rowsFor(userId));
        expect(rows.get("today:overall")).toMatchObject({
            points: 60,
            wins: 1,
            played: 1,
        });
        expect(
            await dataSource
                .getRepository(DailyResult)
                .countBy({ userId, puzzleId: keywords.id }),
        ).toBe(1);
    });

    it("never writes an entry for an archive or weekly finish", async () => {
        const userId = await createUser();
        const today = dailyToday();
        const archive = await puzzle(addDays(today, -10));
        const weekly = await puzzle(today, DailyMode.SPECS, "weekly");

        await dailyService.play(userId, archive.id, {
            guesses: [ANSWER_ID],
        });
        await dailyService.play(userId, weekly.id, { guesses: [ANSWER_ID] });

        expect(await rowsFor(userId)).toEqual([]);
    });
});
