import { YearRecapDto } from "./dto/year-recap.dto";
import { getIconNameForPlatformAbbreviation } from "../game/game-repository/game-repository.utils";
import {
    RecapCalendarDto,
    RecapPlaytimeByPlatformDto,
    RecapTopGameDto,
} from "./dto/recap-derivations.dto";

interface RecapPlayedGameSource {
    gameId: number;
    platformId: number;
    totalPlaytimeSeconds: number;
    firstPlayedAt: string | null;
    finishedAt: Date | null;
    rating: number | null;
}

const SHARE_PRECISION = 10_000;

export const recapCacheId = (userId: string, year: number) =>
    `recap_by_user_${userId}_year_${year}`;

const isLeapYear = (year: number) =>
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const daysInYear = (year: number) => (isLeapYear(year) ? 366 : 365);

const utcDayOfYear = (year: number, day: number) =>
    new Date(Date.UTC(year, 0, day + 1));

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

const share = (part: number, total: number) =>
    total === 0
        ? 0
        : Math.round((part / total) * SHARE_PRECISION) / SHARE_PRECISION;

/**
 * Derives the Recap calendar from the stored per-day playtime. Returns null for
 * Recaps generated before the daily calendar existed.
 */
export function deriveCalendarHighlights(
    daily: number[] | null,
    year: number,
): RecapCalendarDto | null {
    if (daily == null) return null;

    const monthlyPlaytimeSeconds = Array.from({ length: 12 }, () => 0);
    const weekdaySeconds = Array.from({ length: 7 }, () => 0);
    let totalSeconds = 0;
    let weekendSeconds = 0;
    let streakStart = -1;
    let longestStreak: RecapCalendarDto["longestStreak"] = null;

    for (let day = 0; day < daysInYear(year); day++) {
        const seconds = daily[day] ?? 0;
        const date = utcDayOfYear(year, day);
        const weekday = date.getUTCDay();

        monthlyPlaytimeSeconds[date.getUTCMonth()] += seconds;
        weekdaySeconds[weekday] += seconds;
        totalSeconds += seconds;
        if (weekday === 0 || weekday === 6) {
            weekendSeconds += seconds;
        }

        if (seconds > 0) {
            if (streakStart < 0) streakStart = day;
            const days = day - streakStart + 1;
            if (!longestStreak || days > longestStreak.days) {
                longestStreak = {
                    start: isoDay(utcDayOfYear(year, streakStart)),
                    end: isoDay(date),
                    days,
                };
            }
        } else {
            streakStart = -1;
        }
    }

    if (totalSeconds === 0) {
        return {
            monthlyPlaytimeSeconds,
            topMonth: null,
            longestStreak: null,
            topWeekday: null,
            weekendShare: 0,
        };
    }

    const topMonthIndex = monthlyPlaytimeSeconds.reduce(
        (top, seconds, month) =>
            seconds > monthlyPlaytimeSeconds[top] ? month : top,
        0,
    );
    const topWeekdayIndex = weekdaySeconds.reduce(
        (top, seconds, weekday) =>
            seconds > weekdaySeconds[top] ? weekday : top,
        0,
    );

    return {
        monthlyPlaytimeSeconds,
        topMonth: {
            month: topMonthIndex + 1,
            playtimeSeconds: monthlyPlaytimeSeconds[topMonthIndex],
        },
        longestStreak,
        topWeekday: {
            weekday: topWeekdayIndex,
            share: share(weekdaySeconds[topWeekdayIndex], totalSeconds),
        },
        weekendShare: share(weekendSeconds, totalSeconds),
    };
}

/**
 * Aggregates played-game rows (one per game, source and platform) into one
 * entry per game, ordered by playtime.
 */
export function deriveTopGames(
    playedGames: readonly RecapPlayedGameSource[],
): RecapTopGameDto[] {
    const totalSeconds = playedGames.reduce(
        (total, game) => total + game.totalPlaytimeSeconds,
        0,
    );
    const byGame = new Map<number, RecapTopGameDto>();

    for (const playedGame of playedGames) {
        const existing = byGame.get(playedGame.gameId);
        if (!existing) {
            byGame.set(playedGame.gameId, {
                gameId: playedGame.gameId,
                platformIds: [playedGame.platformId],
                totalPlaytimeSeconds: playedGame.totalPlaytimeSeconds,
                share: 0,
                firstPlayedAt: playedGame.firstPlayedAt,
                finishedAt: playedGame.finishedAt,
                rating: playedGame.rating,
            });
            continue;
        }

        existing.totalPlaytimeSeconds += playedGame.totalPlaytimeSeconds;
        if (!existing.platformIds.includes(playedGame.platformId)) {
            existing.platformIds.push(playedGame.platformId);
        }
        if (
            playedGame.firstPlayedAt != null &&
            (existing.firstPlayedAt == null ||
                playedGame.firstPlayedAt < existing.firstPlayedAt)
        ) {
            existing.firstPlayedAt = playedGame.firstPlayedAt;
        }
        if (
            playedGame.finishedAt != null &&
            (existing.finishedAt == null ||
                playedGame.finishedAt < existing.finishedAt)
        ) {
            existing.finishedAt = playedGame.finishedAt;
        }
        if (existing.rating == null) existing.rating = playedGame.rating;
    }

    return Array.from(byGame.values())
        .map((game) => ({
            ...game,
            share: share(game.totalPlaytimeSeconds, totalSeconds),
        }))
        .toSorted(
            (a, b) =>
                b.totalPlaytimeSeconds - a.totalPlaytimeSeconds ||
                a.gameId - b.gameId,
        );
}

export function derivePlaytimeByPlatform(
    playedGames: readonly RecapPlayedGameSource[],
): RecapPlaytimeByPlatformDto[] {
    const totalSeconds = playedGames.reduce(
        (total, game) => total + game.totalPlaytimeSeconds,
        0,
    );
    const byPlatform = new Map<number, number>();

    for (const playedGame of playedGames) {
        byPlatform.set(
            playedGame.platformId,
            (byPlatform.get(playedGame.platformId) ?? 0) +
                playedGame.totalPlaytimeSeconds,
        );
    }

    return Array.from(byPlatform, ([platform, seconds]) => ({
        platform,
        totalPlaytimeSeconds: seconds,
        share: share(seconds, totalSeconds),
    })).toSorted(
        (a, b) =>
            b.totalPlaytimeSeconds - a.totalPlaytimeSeconds ||
            a.platform - b.platform,
    );
}

export function deriveBacklogGrowth(
    totalAddedGames: number,
    totalFinishedGames: number,
    totalDroppedGames: number,
): number {
    return Math.max(
        0,
        totalAddedGames - totalFinishedGames - totalDroppedGames,
    );
}

/**
 * Updates game platforms within a recap entity in-place to include their icon names.
 * @param entity
 */
export function transformRecapPlatforms(entity: Partial<YearRecapDto>) {
    if (entity.playedGames) {
        entity.playedGames.forEach((pg) => {
            if (pg.platform == undefined) return;

            pg.platform = {
                ...pg.platform,
                iconName: getIconNameForPlatformAbbreviation(
                    pg.platform.abbreviation,
                ),
            };
        });
    }
}

export function transformRecapDistributions(entity: Partial<YearRecapDto>) {
    if (entity.genres) {
        entity.distributionByGenre = entity.genres.map((genre) => {
            return {
                criteriaId: genre.genre.id,
                criteriaName: genre.genre.name!,
                count: genre.totalGames,
                finishedCount: genre.totalGamesFinished,
            };
        });
    }
    if (entity.themes) {
        entity.distributionByTheme = entity.themes.map((theme) => {
            return {
                criteriaId: theme.theme.id,
                criteriaName: theme.theme.name!,
                count: theme.totalGames,
                finishedCount: theme.totalGamesFinished,
            };
        });
    }
    if (entity.modes) {
        entity.distributionByMode = entity.modes.map((mode) => {
            return {
                criteriaId: mode.mode.id,
                criteriaName: mode.mode.name!,
                count: mode.totalGames,
                finishedCount: mode.totalGamesFinished,
            };
        });
    }
    if (entity.platforms) {
        entity.distributionByPlatform = entity.platforms.map((platform) => {
            return {
                criteriaId: platform.platform.id,
                criteriaName: platform.platform.name!,
                count: platform.totalGames,
                finishedCount: platform.totalGamesFinished,
            };
        });
    }
}
