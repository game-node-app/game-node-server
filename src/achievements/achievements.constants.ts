/**
 * Achievements categories, used to group definitions in clients.
 */
export enum AchievementCategory {
    COLLECTIONS,
    FOLLOWERS,
    REVIEWS,
    COMMENTS,
    MISC,
    EVENTS,
}

export enum AchievementStatus {
    DRAFT = "draft",
    PUBLISHED = "published",
    ARCHIVED = "archived",
}

export type AchievementIcon =
    | { kind: "glyph"; name: string }
    | { kind: "game_cover"; gameId: number }
    | { kind: "image"; name: string };
