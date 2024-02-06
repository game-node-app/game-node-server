import { AchievementCategory } from "../achievements.constants";

export interface AchievementsQueueJob {
    targetUserId: string;
    category: AchievementCategory;
}

export const ACHIEVEMENTS_QUEUE_NAME = "achievements-queue";

export const ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME = "track";
