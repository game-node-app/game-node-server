import { Period } from "../../../utils/period";

/**
 * Periods accepted by the summary. Windows are rolling (the last 7, 30 or 365
 * days up to now), so a card shared on a Monday is not empty.
 */
export type ProfileMetricsSummaryPeriod =
    | Period.WEEK
    | Period.MONTH
    | Period.YEAR;

export class ProfileMetricsSummaryGameDto {
    gameId: number;
    /** Playtime in the window, summed over every source and platform. */
    totalPlaytimeSeconds: number;
}

export class ProfileMetricsSummaryNamedTotalDto {
    id: number;
    name: string;
    totalPlaytimeSeconds: number;
}

export class ProfileMetricsSummaryWindowDto {
    totalPlaytimeSeconds: number;
    /**
     * Part of `totalPlaytimeSeconds` estimated from games' first observations:
     * Steam's recent total spread over the 14 days before it, or the first
     * total spread over the provider's played dates (PSN, Nintendo) or since
     * the previous sync (Xbox games new to a syncing connection).
     */
    estimatedPlaytimeSeconds: number;
    /** Distinct games with playtime in the window. */
    totalGames: number;
}

/**
 * Playtime figures are estimates from observed cumulative totals. Increments
 * are attributed to the observation that ended them; a game's first
 * observation is spread over the time it was likely played (see
 * `estimatedPlaytimeSeconds`). Values are not exact play sessions or dates.
 */
export class ProfileMetricsSummaryResponseDto {
    period: ProfileMetricsSummaryPeriod;
    current: ProfileMetricsSummaryWindowDto;
    /**
     * The window of the same length that ends where the current one starts.
     * A game first observed after this end can still contribute the part of
     * its first-observation estimate that falls inside it.
     */
    previous: ProfileMetricsSummaryWindowDto;
    /** The five most played games of the current window, most played first. */
    topGames: ProfileMetricsSummaryGameDto[];
    /**
     * Genre with the most playtime. A game counts fully toward each of its
     * genres. `null` when nothing was played or the games have no genre.
     */
    topGenre: ProfileMetricsSummaryNamedTotalDto | null;
    topPlatform: ProfileMetricsSummaryNamedTotalDto | null;
    playedInPeriod: number;
    finishedInPeriod: number;
    reviewedInPeriod: number;
}
