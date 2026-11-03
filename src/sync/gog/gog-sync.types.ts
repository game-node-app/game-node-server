export interface GogTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    user_id?: string;
}

export interface GogProfile {
    id: string;
    username: string;
}

export interface GogRelease {
    platform_id: string;
    external_id: string;
    owned: boolean;
}

export interface GogReleasesPage {
    total_count: number;
    limit: number;
    items: GogRelease[];
    next_page_token?: string | null;
}

export interface GogSessionsResponse {
    time_sum: number;
}

// Item fields are evidenced by Heroic types; live captures currently contain only empty sets.
export interface GogAchievement {
    achievement_id: string;
    visible: boolean;
    name: string;
    description: string;
    image_url_unlocked: string;
    image_url_locked: string;
    date_unlocked: string | null;
}

export interface GogAchievementsPage {
    total_count: number;
    limit: number;
    page_token: string;
    items: GogAchievement[];
    achievements_mode: string;
}
