import { QueryFailedError } from "typeorm";
import { DailyScheduler } from "./daily.scheduler";
import { addDays, DailyMode, dailyToday } from "./daily.constants";
import { DAILY_POOL_WINDOW, WEEKLY_POOL_WINDOW } from "./daily-pool.service";

/** Fakes the puzzle repository: `find` serves the dates that already exist per kind. */
const repository = ({
    daily = [],
    weekly = [],
    max = {},
}: {
    daily?: string[];
    weekly?: string[];
    max?: Record<string, number>;
} = {}) => {
    const maxes: Record<string, number> = { ...max };
    const state: { kind?: string; mode?: string } = {};
    const builder = {
        select: () => builder,
        where: (_sql: string, params: { kind: string; mode: string }) => {
            Object.assign(state, params);
            return builder;
        },
        getRawOne: async () => ({
            max: maxes[`${state.kind}:${state.mode}`] ?? 0,
        }),
    };
    return {
        find: jest.fn(async ({ where }: any) =>
            (where.kind === "weekly" ? weekly : daily).map((date) => ({
                date,
            })),
        ),
        insert: jest.fn(async (puzzle: any) => {
            maxes[`${puzzle.kind}:${puzzle.mode}`] = puzzle.number;
        }),
        createQueryBuilder: jest.fn(() => builder),
    };
};

const picker = () => ({
    pick: jest.fn().mockResolvedValue({ gameId: 1, meta: {} }),
});

const rounds = () => ({ delete: jest.fn().mockResolvedValue({ affected: 1 }) });

const ranker = () => ({
    rebuildIfEmpty: jest.fn().mockResolvedValue(undefined),
    snapshotIfNeeded: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn().mockResolvedValue(undefined),
});

it("warns for empty picks and leaves existing puzzles untouched", async () => {
    const repo = repository({ daily: [dailyToday()] });
    const pool = { pick: jest.fn().mockResolvedValue(null) };
    const scheduler = new DailyScheduler(
        repo as any,
        pool as any,
        rounds() as any,
        ranker() as any,
    );
    const warning = jest
        .spyOn((scheduler as any).logger, "warn")
        .mockImplementation();
    await scheduler.ensurePuzzles();
    // 7 days ahead for each daily mode, plus this and next week's challenge.
    const calls = Object.values(DailyMode).length * 7 + 2;
    expect(pool.pick).toHaveBeenCalledTimes(calls);
    expect(warning).toHaveBeenCalledTimes(calls);
    expect(repo.insert).not.toHaveBeenCalled();
});

it("numbers puzzles per kind and dates weekly challenges on the Mondays", async () => {
    const repo = repository({
        max: { "daily:cover": 40, "daily:specs": 100, "weekly:specs": 7 },
    });
    const pool = picker();
    const scheduler = new DailyScheduler(
        repo as any,
        pool as any,
        rounds() as any,
        ranker() as any,
    );
    await scheduler.ensurePuzzles();

    const inserted = repo.insert.mock.calls.map(([puzzle]: any[]) => puzzle);
    const daily = inserted.filter((puzzle) => puzzle.kind === "daily");
    const weekly = inserted.filter((puzzle) => puzzle.kind === "weekly");
    expect(daily).toHaveLength(Object.values(DailyMode).length * 8);
    expect(weekly).toHaveLength(2);
    expect(
        daily
            .filter((puzzle) => puzzle.mode === DailyMode.SPECS)
            .map((puzzle) => puzzle.number),
    ).toEqual([101, 102, 103, 104, 105, 106, 107, 108]);
    expect(weekly.map((puzzle) => puzzle.number)).toEqual([8, 9]);

    const today = dailyToday();
    const [current, next] = weekly;
    for (const puzzle of weekly) {
        expect(puzzle.mode).toBe(DailyMode.SPECS);
        expect(new Date(`${puzzle.date}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    expect(next.date).toBe(addDays(current.date, 7));
    expect(current.date <= today).toBe(true);
    expect(today <= addDays(current.date, 6)).toBe(true);

    expect(pool.pick).toHaveBeenCalledWith(
        DailyMode.SPECS,
        current.date,
        WEEKLY_POOL_WINDOW,
    );
    expect(pool.pick).toHaveBeenCalledWith(
        DailyMode.COVER,
        expect.any(String),
        DAILY_POOL_WINDOW,
    );
});

it("ignores the weekly puzzle another replica inserted first", async () => {
    const repo = repository();
    repo.insert.mockImplementation(async (puzzle: any) => {
        if (puzzle.kind === "weekly")
            throw new QueryFailedError("INSERT", [], {
                code: "ER_DUP_ENTRY",
            } as any);
    });
    const scheduler = new DailyScheduler(
        repo as any,
        picker() as any,
        rounds() as any,
        ranker() as any,
    );
    await expect(scheduler.ensurePuzzles()).resolves.toBeUndefined();
    expect(repo.insert).toHaveBeenCalledTimes(
        Object.values(DailyMode).length * 8 + 2,
    );
});

it("deletes practice rounds past their week and past ranking partitions", async () => {
    const repo = rounds();
    const ranking = ranker();
    const scheduler = new DailyScheduler(
        repository() as any,
        picker() as any,
        repo as any,
        ranking as any,
    );
    await scheduler.cleanupPracticeRounds();

    expect(repo.delete).toHaveBeenCalledTimes(1);
    const { createdAt } = repo.delete.mock.calls[0][0] as any;
    const day = 24 * 60 * 60 * 1000;
    expect(createdAt.type).toBe("lessThan");
    expect(createdAt.value.getTime()).toBeGreaterThan(Date.now() - 7.1 * day);
    expect(createdAt.value.getTime()).toBeLessThan(Date.now() - 6.9 * day);
    expect(ranking.cleanup).toHaveBeenCalledWith(dailyToday());
});

it("keeps the midnight duties separate from a failing ranking cleanup", async () => {
    const repo = rounds();
    const ranking = ranker();
    ranking.cleanup.mockRejectedValue(new Error("ranking down"));
    const scheduler = new DailyScheduler(
        repository() as any,
        picker() as any,
        repo as any,
        ranking as any,
    );
    jest.spyOn((scheduler as any).logger, "error").mockImplementation();
    await expect(scheduler.cleanupPracticeRounds()).resolves.toBeUndefined();
    expect(repo.delete).toHaveBeenCalledTimes(1);
});

it("rebuilds and snapshots the ranking on boot after ensuring the puzzles", async () => {
    const ranking = ranker();
    const scheduler = new DailyScheduler(
        repository({ daily: [dailyToday()] }) as any,
        picker() as any,
        rounds() as any,
        ranking as any,
    );
    await (scheduler as any).bootstrap();

    const today = dailyToday();
    expect(ranking.rebuildIfEmpty).toHaveBeenCalledWith(today);
    expect(ranking.snapshotIfNeeded).toHaveBeenCalledWith(today);
    expect(ranking.rebuildIfEmpty.mock.invocationCallOrder[0]).toBeLessThan(
        ranking.snapshotIfNeeded.mock.invocationCallOrder[0],
    );
});

it("snapshots the previous positions at midnight", async () => {
    const ranking = ranker();
    const scheduler = new DailyScheduler(
        repository() as any,
        picker() as any,
        rounds() as any,
        ranking as any,
    );
    await scheduler.snapshotRanking();

    expect(ranking.snapshotIfNeeded).toHaveBeenCalledWith(dailyToday());
});
