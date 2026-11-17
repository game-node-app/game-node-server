import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { createNotificationTestDataSource } from "../../test/notifications/notification-test-harness";
import { DailyPuzzle } from "./entity/daily-puzzle.entity";
import { DailyRankingEntry } from "./entity/daily-ranking-entry.entity";
import { DailyRankingSnapshot } from "./entity/daily-ranking-snapshot.entity";
import { DailyRankingService } from "./daily-ranking.service";
import { DailyMode, DailyStatus, mondayOf } from "./daily.constants";

const FIXTURE_NUMBER = 960_000;
// Wednesday: the week starts on 2026-03-02 and the month on 2026-03-01.
const TODAY = "2026-03-04";

describe("DailyRankingService snapshots on MySQL", () => {
    jest.setTimeout(120000);

    let dataSource: DataSource;
    let service: DailyRankingService;
    let fixtureCount = 0;
    const users: string[] = [];
    const cache = new Map<string, unknown>();

    const cleanup = async () => {
        await dataSource.query("DELETE FROM daily_puzzle WHERE number >= ?", [
            FIXTURE_NUMBER,
        ]);
        // Snapshots have no foreign key, so this suite removes the past dates it owns.
        await dataSource.query(
            "DELETE FROM daily_ranking_snapshot WHERE date IN (?, ?, ?)",
            ["2026-03-02", TODAY, "2026-04-01"],
        );
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
            gameId: 1,
            meta: {},
            source: "admin" as const,
        });

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
            [userId, `snap_${userId.slice(0, 8)}`],
        );
        users.push(userId);
        return userId;
    };

    const addResult = (
        userId: string,
        fixture: DailyPuzzle,
        { points = 10, attempts = 1 } = {},
    ) =>
        dataSource.query(
            `INSERT INTO daily_result
                 (userId, puzzleId, guesses, hintAt, status, ranked, points, attempts, finishedAt)
             VALUES (?, ?, ?, NULL, ?, 1, ?, ?, ?)`,
            [
                userId,
                fixture.id,
                "[]",
                DailyStatus.WON,
                points,
                attempts,
                `${fixture.date} 12:00:00`,
            ],
        );

    const snapshotRows = (date: string, period?: string, mode?: string) =>
        dataSource.getRepository(DailyRankingSnapshot).find({
            where: {
                date,
                ...(period && { period: period as any }),
                ...(mode && { mode: mode as any }),
            },
            order: { period: "ASC", mode: "ASC", position: "ASC" },
        });

    beforeAll(async () => {
        dataSource = await createNotificationTestDataSource();
        await cleanup();
        const cacheMock = {
            get: async (key: string) => cache.get(key),
            set: async (key: string, value: unknown) => {
                cache.set(key, value);
            },
        };
        service = new DailyRankingService(
            dataSource,
            { getLockoutStates: async () => new Map() } as any,
            cacheMock as any,
            { findSupporterUserIds: async () => [] } as any,
        );
    });

    beforeEach(() => cache.clear());

    afterAll(async () => {
        if (dataSource?.isInitialized) {
            await cleanup();
            await dataSource.destroy();
        }
    });

    it("numbers the list without today's puzzles when today already has finishes", async () => {
        const up = await createUser();
        const steady = await createUser();
        const fresh = await createUser();
        await addResult(up, await puzzle("2026-03-03"), { points: 100 });
        await addResult(up, await puzzle(TODAY), { points: 40 });
        await addResult(steady, await puzzle("2026-03-03", DailyMode.ARTWORK), {
            points: 200,
        });
        await addResult(fresh, await puzzle(TODAY, DailyMode.KEYWORDS), {
            points: 10,
        });
        for (const userId of [up, steady, fresh])
            await service.recompute(userId, TODAY);

        await service.snapshot(TODAY);

        const fixture = new Set([up, steady, fresh]);
        const rows = (await snapshotRows(TODAY, "week", "overall")).filter(
            (row) => fixture.has(row.userId),
        );
        expect(rows.map((row) => row.userId)).toEqual([steady, up]);
        expect(rows[0].position).toBeLessThan(rows[1].position);
        expect(rows.map((row) => row.userId)).not.toContain(fresh);
    });

    it("snapshots all fifteen period and mode partitions", async () => {
        const userId = await createUser();
        for (const mode of Object.values(DailyMode))
            await addResult(userId, await puzzle("2026-03-03", mode));
        await service.recompute(userId, TODAY);
        // No result today: today's partition is not written, the other three are.
        expect(
            await dataSource
                .getRepository(DailyRankingEntry)
                .countBy({ userId }),
        ).toBe(15);

        await service.snapshot(TODAY);

        const rows = await snapshotRows(TODAY);
        const mine = rows.filter((row) => row.userId === userId);
        expect(mine).toHaveLength(15);
        expect(
            new Set(mine.map((row) => `${row.period}:${row.mode}`)).size,
        ).toBe(15);
        expect(mine.every((row) => row.position >= 1)).toBe(true);
    });

    it("leaves the new week empty on a Monday and the new month empty on the 1st", async () => {
        const monday = "2026-03-02";
        const mondayUser = await createUser();
        await addResult(mondayUser, await puzzle("2026-02-23"), { points: 10 });
        await addResult(mondayUser, await puzzle(monday), { points: 20 });
        await service.recompute(mondayUser, monday);
        await service.snapshot(monday);

        expect(
            (await snapshotRows(monday, "week")).filter(
                (row) => row.userId === mondayUser,
            ),
        ).toEqual([]);
        expect(
            (await snapshotRows(monday, "month")).filter(
                (row) => row.userId === mondayUser,
            ),
        ).toEqual([]);
        // The all-time partition still remembers the previous week.
        expect(
            (await snapshotRows(monday, "all")).filter(
                (row) => row.userId === mondayUser,
            ),
        ).not.toHaveLength(0);

        const first = "2026-04-01";
        const firstUser = await createUser();
        await addResult(firstUser, await puzzle("2026-03-31"), { points: 10 });
        await addResult(firstUser, await puzzle(first), { points: 20 });
        await service.recompute(firstUser, first);
        await service.snapshot(first);

        expect(
            (await snapshotRows(first, "month")).filter(
                (row) => row.userId === firstUser,
            ),
        ).toEqual([]);
        expect(
            (await snapshotRows(first, "week")).filter(
                (row) => row.userId === firstUser,
            ),
        ).not.toHaveLength(0);
    });

    it("writes the same rows when the snapshot runs again", async () => {
        const userId = await createUser();
        await addResult(userId, await puzzle("2026-03-03"), { points: 10 });
        await service.recompute(userId, TODAY);

        await service.snapshot(TODAY);
        const first = await snapshotRows(TODAY);
        await service.snapshot(TODAY);

        expect(await snapshotRows(TODAY)).toEqual(first);
    });

    it("cleans past partitions and keeps current ones and today's snapshot", async () => {
        const userId = await createUser();
        await addResult(userId, await puzzle("2026-02-10"), { points: 5 });
        await addResult(userId, await puzzle("2026-03-03"), { points: 10 });
        await addResult(userId, await puzzle(TODAY), { points: 20 });
        await service.recompute(userId, "2026-02-10");
        await service.recompute(userId, "2026-03-03");
        await service.snapshot("2026-03-03");
        await service.recompute(userId, TODAY);
        await service.snapshot(TODAY);

        await service.cleanup(TODAY);

        const entries = await dataSource
            .getRepository(DailyRankingEntry)
            .findBy({ userId });
        expect(
            entries.find(
                (entry) =>
                    entry.period === "today" &&
                    entry.periodStart === "2026-03-03",
            ),
        ).toBeUndefined();
        expect(
            entries.find(
                (entry) =>
                    entry.period === "today" && entry.periodStart === TODAY,
            ),
        ).toBeDefined();
        expect(
            entries.find(
                (entry) =>
                    entry.period === "week" &&
                    entry.periodStart === mondayOf(TODAY),
            ),
        ).toBeDefined();
        expect(
            entries.find(
                (entry) =>
                    entry.period === "month" &&
                    entry.periodStart === `${TODAY.slice(0, 8)}01`,
            ),
        ).toBeDefined();
        expect(entries.find((entry) => entry.period === "all")).toBeDefined();
        expect(
            entries.find(
                (entry) =>
                    entry.period === "week" &&
                    entry.periodStart === "2026-02-09",
            ),
        ).toBeUndefined();
        expect(
            entries.find(
                (entry) =>
                    entry.period === "month" &&
                    entry.periodStart === "2026-02-01",
            ),
        ).toBeUndefined();

        const snapshots = await dataSource
            .getRepository(DailyRankingSnapshot)
            .findBy({ userId });
        expect(
            snapshots.find((row) => row.date === "2026-03-03"),
        ).toBeUndefined();
        expect(snapshots.find((row) => row.date === TODAY)).toBeDefined();
    });

    it("marks the day complete and skips the boot run while the marker or lock is held", async () => {
        const userId = await createUser();
        await addResult(userId, await puzzle("2026-03-03"), { points: 30 });
        await addResult(userId, await puzzle(TODAY), { points: 60 });
        await service.recompute(userId, TODAY);
        const marker = `daily:ranking:snapshot:${TODAY}`;

        await service.snapshotIfNeeded(TODAY);
        expect(cache.get(marker)).toBe(true);
        expect(
            (await snapshotRows(TODAY)).filter((row) => row.userId === userId),
        ).not.toHaveLength(0);

        // The marker skips a boot that finds today's snapshot already written.
        await dataSource.query(
            "DELETE FROM daily_ranking_snapshot WHERE date = ?",
            [TODAY],
        );
        await service.snapshotIfNeeded(TODAY);
        expect(await snapshotRows(TODAY)).toEqual([]);

        // The pinned named lock lets only one replica run it.
        cache.clear();
        const runner = dataSource.createQueryRunner();
        try {
            await runner.connect();
            const [lock] = await runner.query(
                "SELECT GET_LOCK('daily_ranking_snapshot', 0) AS acquired",
            );
            expect(Number(lock.acquired)).toBe(1);
            await service.snapshotIfNeeded(TODAY);
            expect(await snapshotRows(TODAY)).toEqual([]);
        } finally {
            await runner.query("SELECT RELEASE_LOCK('daily_ranking_snapshot')");
            await runner.release();
        }

        await service.snapshotIfNeeded(TODAY);
        expect(await snapshotRows(TODAY)).not.toEqual([]);
        expect(cache.get(marker)).toBe(true);
    });
});
