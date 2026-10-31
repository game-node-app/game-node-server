export interface AchievementsQueueJob {
    userId: string;
    /**
     * Key of a metric in achievement-metrics.ts
     */
    metric: string;
}

export interface AchievementsBackfillJob {
    definitionId: string;
    afterUserId: string | null;
    /**
     * Distinguishes backfills started by later tier additions from a running one
     */
    generation: number;
}

export const ACHIEVEMENTS_QUEUE_NAME = "achievements-queue";

export const ACHIEVEMENTS_QUEUE_TRACKING_JOB_NAME = "track";

export const ACHIEVEMENTS_BACKFILL_QUEUE_NAME = "achievements-backfill-queue";

export const ACHIEVEMENTS_BACKFILL_JOB_NAME = "backfill";

/**
 * Bursts of tracking jobs for the same user and metric within this window run once
 */
export const ACHIEVEMENTS_TRACKING_DELAY_MS = 2000;
