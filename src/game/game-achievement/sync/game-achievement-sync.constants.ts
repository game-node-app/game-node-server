import type { PlayerSyncOwner } from "../../../sync/player-data/player-sync-state.service";
export const GAME_ACHIEVEMENT_SYNC_QUEUE_NAME = "game-achievement-sync";

export const GAME_ACHIEVEMENT_XBOX_JOB_NAME = "game-achievement-xbox-sync";

export const GAME_ACHIEVEMENT_PLAYSTATION_JOB_NAME =
    "game-achievement-playstation-sync";

export const GAME_ACHIEVEMENT_STEAM_JOB_NAME = "game-achievement-steam-sync";

export interface GameAchievementObtainedUpdateJob {
    userId: string;
    owner?: PlayerSyncOwner;
    externalGameId: number;
    activityFingerprint?: string;
}
