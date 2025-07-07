export interface IGDBAuthInfo {
    access_token: string;
    // Expiration in seconds
    expires_in: number;
    // = bearer
    token_type: string;
}

export interface IGDBTimeToBeatPlaytime {
    id: number;
    game_id: number;
    hastily: number;
    normally: number;
    completely: number;
    count: number;
    created_at: number;
    updated_at: number;
    checksum: string;
}

/**
 * BullMQ queue name.
 */
export const IGDB_SYNC_QUEUE_NAME = "igdb-sync-queue";

/**
 * BullMQ queue job name
 */
export const IGDB_SYNC_JOB_NAME = "igdb-sync";
