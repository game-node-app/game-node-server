/** Daily puzzles compete for ranking points; weekly challenges are separate. */
export type DailyPuzzleKind = "daily" | "weekly";

/** Practice rounds are temporary: older rows are deleted and read as missing. */
export const PRACTICE_ROUND_TTL_DAYS = 7;

export enum DailyMode {
    COVER = "cover",
    ARTWORK = "artwork",
    KEYWORDS = "keywords",
    SPECS = "specs",
}

export enum DailyStatus {
    IN_PROGRESS = "in_progress",
    WON = "won",
    LOST = "lost",
}

export enum DailyGuessResult {
    CORRECT = "correct",
    FRANCHISE = "franchise",
    WRONG = "wrong",
    SKIPPED = "skipped",
}

export enum DailyMatch {
    MATCH = "match",
    PARTIAL = "partial",
    NONE = "none",
}

export const DAILY_MAX_ATTEMPTS: Record<DailyMode, number> = {
    [DailyMode.COVER]: 6,
    [DailyMode.ARTWORK]: 6,
    [DailyMode.KEYWORDS]: 6,
    [DailyMode.SPECS]: 10,
};

/**
 * Ranking points in tenths (6 -> 60, 0.6 -> 6): 7 - attempts for the image modes,
 * 0.6 per remaining life for Specs. Only a counted win scores.
 */
export const dailyPoints = (
    mode: DailyMode,
    status: DailyStatus,
    attempts: number,
) =>
    status === DailyStatus.WON
        ? (mode === DailyMode.SPECS ? 6 : 10) *
          (DAILY_MAX_ATTEMPTS[mode] + 1 - attempts)
        : 0;

/** Pixelation width per image level; the last level is the sharpest before "full". */
export const DAILY_IMAGE_WIDTHS = [8, 12, 20, 32, 56, 96];

export const DAILY_TIME_ZONE = "America/Sao_Paulo";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rounds created before this instant are past their lifetime. */
export const practiceRoundsCutoff = (now = new Date()) =>
    new Date(now.getTime() - PRACTICE_ROUND_TTL_DAYS * DAY_MS);

/** Today's puzzle date ("YYYY-MM-DD") in São Paulo. */
export const dailyToday = (now = new Date()) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: DAILY_TIME_ZONE }).format(now);

export const addDays = (date: string, days: number) =>
    new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
        .toISOString()
        .slice(0, 10);

/** Monday of the São Paulo week containing `date` ("YYYY-MM-DD"). */
export const mondayOf = (date: string) =>
    addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));

// shortcut: fixed UTC-3 offset (Brazil has had no DST since 2019), derive the offset from DAILY_TIME_ZONE if DST returns
export const dailyNextResetAt = (today: string) =>
    new Date(`${addDays(today, 1)}T00:00:00-03:00`).toISOString();
