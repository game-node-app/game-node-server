export const SUPPORTERS_WALL_CACHE_KEY = "supporters:wall";

/** Shared with the presence cache (design 7). */
export function profilePresenceCacheKey(userId: string) {
    return `profile-presence:${userId}`;
}
