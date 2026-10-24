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
