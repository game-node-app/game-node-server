import type { PlaytimeWatchJob } from "../../playtime/watch/playtime-watch.constants";
import type { PlayerSyncOwner } from "./player-sync-state.service";
export const PLAYER_DATA_QUEUE = "player-data-sync";
export const PLAYER_DATA_JOB = "player-data-refresh";
export interface PlayerDataJob extends PlaytimeWatchJob {
    owner: PlayerSyncOwner;
}
