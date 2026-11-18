import { UserPlaytimeSource } from "./playtime.constants";

export interface PlaytimeInPeriod {
    gameId: number;
    totalPlaytimeInPeriodSeconds: number;
    source: UserPlaytimeSource;
    platformId: number;
    lastPlayedDate: Date;
    firstPlayedDate: Date;
    /**
     * Part of `totalPlaytimeInPeriodSeconds` estimated from a game's first
     * observation (see `firstObservationSpread`).
     */
    estimatedPlaytimeSeconds?: number;
}
