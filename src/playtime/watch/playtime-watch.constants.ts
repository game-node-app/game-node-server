import { UserPlaytimeSource } from "../playtime.constants";

export const PLAYTIME_WATCH_QUEUE_NAME = "playtime-watch-queue";
export const PLAYTIME_WATCH_QUEUE_JOB_NAME = "playtime-watch-queue-job";

export interface PlaytimeWatchJob {
    userId: string;
    source: UserPlaytimeSource;
}

export type PlaytimeWatchJobProgress = {
    gameName?: string;
    totalPlaytimeSeconds?: number;
    totalUpdatedGames?: number;
    platform?: string;
    error?: string;
};
