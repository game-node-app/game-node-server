/**
 * Achievements categories
 * The names are related to the domain that triggers them.
 * e.g. a module related to collections may trigger a collection-related achievement.
 */
export enum AchievementCategory {
    COLLECTIONS,
    FOLLOWERS,
    REVIEWS,
    COMMENTS,
    MISC,
    EVENTS,
}

export const ACHIEVEMENTS_GAME_IDS = {
    JUST_DANCE_IDS: [],
    TOMB_RAIDER_2013: 1164,
    DEATH_STRANDING_IDS: [19564, 152063, 228530],
} as const;

export const ACHIEVEMENTS_GAME_THEMES_IDS = {
    HORROR_ID: 19,
} as const;
