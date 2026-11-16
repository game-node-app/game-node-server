import { UserPlaytimeSource } from "./playtime.constants";

export interface PlaytimeInPeriod {
    gameId: number;
    totalPlaytimeInPeriodSeconds: number;
    source: UserPlaytimeSource;
    platformId: number;
    lastPlayedDate: Date;
    firstPlayedDate: Date;
    /**
     * Part of `totalPlaytimeInPeriodSeconds` estimated from the provider's
     * recent total on the first Steam observation.
     */
    estimatedPlaytimeSeconds?: number;
}
