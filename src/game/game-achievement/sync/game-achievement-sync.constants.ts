export const GAME_ACHIEVEMENT_SYNC_QUEUE_NAME = "game-achievement-sync";

export const GAME_ACHIEVEMENT_SCHEDULER_JOB = "game-achievement-scheduler";

export const GAME_ACHIEVEMENT_SYNC_USER_JOB = "game-achievement-sync-user";

export interface GameAchievementUpdateJob {
    externalGameId: number;
}

export interface GameAchievementObtainedUpdateJob
    extends GameAchievementUpdateJob {
    userId: string;
}
