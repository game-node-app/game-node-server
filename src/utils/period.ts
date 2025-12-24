export enum Period {
    DAY = "day",
    WEEK = "week",
    MONTH = "month",
    THREE_MONTHS = "three_months",
    SIX_MONTHS = "six_months",
    YEAR = "year",
    ALL = "all",
}

export const PeriodToMinusDays: Record<Period, number> = {
    [Period.DAY]: 1,
    [Period.WEEK]: 7,
    [Period.MONTH]: 30,
    [Period.THREE_MONTHS]: 90,
    [Period.SIX_MONTHS]: 180,
    [Period.YEAR]: 365,
    [Period.ALL]: 0,
};

export interface PeriodRange {
    startDate: Date | null;
    endDate: Date;
}
