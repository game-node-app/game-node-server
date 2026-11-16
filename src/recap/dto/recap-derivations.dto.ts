export class RecapCalendarStreakDto {
    /**
     * First UTC day of the streak, as YYYY-MM-DD.
     */
    start: string;
    /**
     * Last UTC day of the streak, as YYYY-MM-DD.
     */
    end: string;
    days: number;
}

export class RecapCalendarTopMonthDto {
    /**
     * Month of the year, 1 to 12.
     */
    month: number;
    playtimeSeconds: number;
}

export class RecapCalendarTopWeekdayDto {
    /**
     * UTC weekday, 0 (Sunday) to 6 (Saturday).
     */
    weekday: number;
    share: number;
}

export class RecapCalendarDto {
    /**
     * Total playtime seconds for each month, January first.
     */
    monthlyPlaytimeSeconds: number[];
    topMonth: RecapCalendarTopMonthDto | null;
    longestStreak: RecapCalendarStreakDto | null;
    topWeekday: RecapCalendarTopWeekdayDto | null;
    weekendShare: number;
}

export class RecapTopGameDto {
    gameId: number;
    platformIds: number[];
    totalPlaytimeSeconds: number;
    share: number;
    firstPlayedAt: string | null;
    finishedAt: Date | null;
    rating: number | null;
}

export class RecapPlaytimeByPlatformDto {
    /**
     * Platform id. Clients resolve its name from the existing platform data.
     */
    platform: number;
    totalPlaytimeSeconds: number;
    share: number;
}
