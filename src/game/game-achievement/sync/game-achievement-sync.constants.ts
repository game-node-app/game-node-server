export const GAME_ACHIEVEMENT_SYNC_QUEUE_NAME = "game-achievement-sync";

export const GAME_ACHIEVEMENT_SYNC_GAME_JOB = "game-achievement-game-sync";

export const GAME_ACHIEVEMENT_SYNC_USER_JOB = "game-achievement-sync-user";

export interface GameAchievementUpdateJob {
    externalGameId: number;
}

export interface GameAchievementObtainedUpdateJob
    extends GameAchievementUpdateJob {
    userId: string;
}
