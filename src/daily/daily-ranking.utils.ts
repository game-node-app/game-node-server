import { addDays, DailyMode, DailyStatus, mondayOf } from "./daily.constants";

export type DailyRankingPeriod = "today" | "week" | "month" | "all";

export type DailyRankingScope = "all" | "following";

/** First day of the `all` partition: any day before the first result works. */
export const RANKING_ALL_START = "2000-01-01";

/** Two points, in tenths. */
export const COMPLETION_BONUS = 20;

const MODES = Object.values(DailyMode);

export interface DailyStreaks {
    /** Consecutive days with a counted win, ending today or yesterday. */
    current: number;
    best: Record<DailyMode, number>;
}

/** A counted result read from `daily_result`; the only input of the entry totals. */
export interface RankedDailyResult {
    mode: DailyMode;
    date: string;
    points: number;
    status: DailyStatus;
    attempts: number;
    finishedAt: Date;
}

/** One `daily_ranking_entry` row, without its user id. */
export interface DailyRankingTotals {
    period: DailyRankingPeriod;
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
    lastFinishedAt: Date;
    prevPoints: number;
    prevPlayed: number;
    prevWinAttempts: number;
    prevLastFinishedAt: Date | null;
    /** The São Paulo day this recompute ran. */
    asOf: string;
    streak: number;
    streakEnd: string | null;
    bestStreak: number;
}

interface Slice {
    points: number;
    bonusDays: number;
    modePoints: Record<DailyMode, number>;
    wins: number;
    played: number;
    winAttempts: number;
    lastFinishedAt: Date | null;
}

const slice = (results: RankedDailyResult[]): Slice => {
    const modePoints = Object.fromEntries(
        MODES.map((mode) => [mode, 0]),
    ) as Record<DailyMode, number>;
    const wonModesByDay = new Map<string, Set<DailyMode>>();
    let points = 0;
    let wins = 0;
    let winAttempts = 0;
    let lastFinishedAt: Date | null = null;
    for (const result of results) {
        points += result.points;
        modePoints[result.mode] += result.points;
        if (result.status === DailyStatus.WON) {
            wins++;
            winAttempts += result.attempts;
            const modes = wonModesByDay.get(result.date) ?? new Set();
            modes.add(result.mode);
            wonModesByDay.set(result.date, modes);
        }
        if (!lastFinishedAt || result.finishedAt > lastFinishedAt)
            lastFinishedAt = result.finishedAt;
    }
    // The bonus belongs to a day; mode rows never add it.
    const bonusDays = [...wonModesByDay.values()].filter(
        (modes) => modes.size === MODES.length,
    ).length;
    return {
        points,
        bonusDays,
        modePoints,
        wins,
        played: results.length,
        winAttempts,
        lastFinishedAt,
    };
};

/**
 * Builds a player's rows for the partitions containing `today`, with absolute values.
 * A partition without a result is not written: the player does not appear in it.
 */
export const buildRankingTotals = (
    results: RankedDailyResult[],
    today: string,
): DailyRankingTotals[] => {
    if (!results.length) return [];
    const wins = results
        .filter((result) => result.status === DailyStatus.WON)
        .map(({ mode, date }) => ({ mode, date }));
    const latestWin = [...wins.map((win) => win.date)].sort().at(-1) ?? null;
    // The run ending at the latest win, so a read can tell whether it is still alive.
    const latestRun = latestWin ? computeStreaks(wins, latestWin) : null;
    const streaks = computeStreaks(wins, today);
    const periods: { period: DailyRankingPeriod; start: string }[] = [
        { period: "today", start: today },
        { period: "week", start: mondayOf(today) },
        { period: "month", start: `${today.slice(0, 8)}01` },
        { period: "all", start: RANKING_ALL_START },
    ];
    const totals: DailyRankingTotals[] = [];
    for (const { period, start } of periods) {
        const inPeriod = results.filter(
            (result) => result.date >= start && result.date <= today,
        );
        if (!inPeriod.length) continue;
        const current = slice(inPeriod);
        if (!current.lastFinishedAt) continue;
        const previous = slice(
            inPeriod.filter((result) => result.date !== today),
        );
        const zero = {
            coverPoints: 0,
            artworkPoints: 0,
            keywordsPoints: 0,
            specsPoints: 0,
        };
        totals.push({
            period,
            periodStart: start,
            mode: "overall",
            points: current.points + current.bonusDays * COMPLETION_BONUS,
            coverPoints: current.modePoints[DailyMode.COVER],
            artworkPoints: current.modePoints[DailyMode.ARTWORK],
            keywordsPoints: current.modePoints[DailyMode.KEYWORDS],
            specsPoints: current.modePoints[DailyMode.SPECS],
            wins: current.wins,
            played: current.played,
            winAttempts: current.winAttempts,
            lastFinishedAt: current.lastFinishedAt,
            prevPoints: previous.points + previous.bonusDays * COMPLETION_BONUS,
            prevPlayed: previous.played,
            prevWinAttempts: previous.winAttempts,
            prevLastFinishedAt: previous.lastFinishedAt,
            asOf: today,
            streak: period === "all" ? (latestRun?.current ?? 0) : 0,
            streakEnd: period === "all" ? latestWin : null,
            bestStreak: 0,
        });
        for (const mode of MODES) {
            const modeResults = inPeriod.filter(
                (result) => result.mode === mode,
            );
            if (!modeResults.length) continue;
            const modeCurrent = slice(modeResults);
            if (!modeCurrent.lastFinishedAt) continue;
            const modePrevious = slice(
                modeResults.filter((result) => result.date !== today),
            );
            totals.push({
                period,
                periodStart: start,
                mode,
                points: modeCurrent.points,
                ...zero,
                wins: modeCurrent.wins,
                played: modeCurrent.played,
                winAttempts: modeCurrent.winAttempts,
                lastFinishedAt: modeCurrent.lastFinishedAt,
                prevPoints: modePrevious.points,
                prevPlayed: modePrevious.played,
                prevWinAttempts: modePrevious.winAttempts,
                prevLastFinishedAt: modePrevious.lastFinishedAt,
                asOf: today,
                streak: 0,
                streakEnd: null,
                bestStreak: period === "all" ? streaks.best[mode] : 0,
            });
        }
    }
    return totals;
};

export const computeStreaks = (
    wins: { mode: DailyMode; date: string }[],
    today: string,
): DailyStreaks => {
    const days = new Set<string>();
    const byMode = new Map<DailyMode, Set<string>>();
    for (const { mode, date } of wins) {
        days.add(date);
        const dates = byMode.get(mode) ?? new Set<string>();
        dates.add(date);
        byMode.set(mode, dates);
    }

    // A streak is still alive when the player has not played yet today.
    let cursor = days.has(today)
        ? today
        : days.has(addDays(today, -1))
          ? addDays(today, -1)
          : null;
    let current = 0;
    while (cursor !== null && days.has(cursor)) {
        current++;
        cursor = addDays(cursor, -1);
    }

    const best = {} as Record<DailyMode, number>;
    for (const mode of Object.values(DailyMode)) {
        let longest = 0;
        let run = 0;
        let previous: string | undefined;
        for (const date of [...(byMode.get(mode) ?? [])].sort()) {
            run =
                previous !== undefined && addDays(previous, 1) === date
                    ? run + 1
                    : 1;
            longest = Math.max(longest, run);
            previous = date;
        }
        best[mode] = longest;
    }
    return { current, best };
};
