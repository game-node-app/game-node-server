export enum UserPlaytimeSource {
    STEAM = "steam",
    PSN = "psn",
    EPICGAMES = "epicgames",
    GOG = "gog",
    BATTLENET = "battlenet",
    EMULATOR = "emulator",
    NWII = "nwii",
    NWIIU = "nwiiu",
    NSWITCH = "nswitch",
}

export enum PlaytimeFiterPeriod {
    WEEK = "week",
    MONTH = "month",
    YEAR = "year",
    ALL = "all",
}

export const PlaytimeFilterPeriodToMinusDays = {
    [PlaytimeFiterPeriod.WEEK]: 7,
    [PlaytimeFiterPeriod.MONTH]: 30,
    [PlaytimeFiterPeriod.YEAR]: 365,
    [PlaytimeFiterPeriod.ALL]: 365 * 100,
};
