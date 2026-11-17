export enum LibraryVisibility {
    Public = "public",
    Followers = "followers",
    Private = "private",
}

/** How the viewer is related to the owner of the library. */
export enum LibraryAudience {
    Owner = "owner",
    Follower = "follower",
    Everyone = "everyone",
}

/** Ordered from the least to the most restrictive level. */
export const LIBRARY_VISIBILITY_LEVELS: readonly LibraryVisibility[] = [
    LibraryVisibility.Public,
    LibraryVisibility.Followers,
    LibraryVisibility.Private,
];

/** A viewer sees a level when their audience rank is at least the level's rank. */
export const LIBRARY_VISIBILITY_RANK: Record<LibraryVisibility, number> = {
    [LibraryVisibility.Public]: 0,
    [LibraryVisibility.Followers]: 1,
    [LibraryVisibility.Private]: 2,
};

export const LIBRARY_AUDIENCE_RANK: Record<LibraryAudience, number> = {
    [LibraryAudience.Everyone]: 0,
    [LibraryAudience.Follower]: 1,
    [LibraryAudience.Owner]: 2,
};

export type LibraryAccess = {
    audience: LibraryAudience;
    libraryVisibility: LibraryVisibility;
    canViewLibrary: boolean;
    visibleEntryLevels: LibraryVisibility[];
};

export function audienceSatisfiesLevel(
    audience: LibraryAudience,
    level: LibraryVisibility,
): boolean {
    return LIBRARY_AUDIENCE_RANK[audience] >= LIBRARY_VISIBILITY_RANK[level];
}

/** Entry levels a viewer in this audience may see, from the least to the most restrictive. */
export function levelsSatisfiedByAudience(
    audience: LibraryAudience,
): LibraryVisibility[] {
    return LIBRARY_VISIBILITY_LEVELS.filter((level) =>
        audienceSatisfiesLevel(audience, level),
    );
}

/**
 * Effective visibility: both the library ceiling and the entry level must allow the audience.
 */
export function isEntryVisible(
    audience: LibraryAudience,
    libraryVisibility: LibraryVisibility,
    entryVisibility: LibraryVisibility,
): boolean {
    return (
        audienceSatisfiesLevel(audience, libraryVisibility) &&
        audienceSatisfiesLevel(audience, entryVisibility)
    );
}

/**
 * Entry levels the audience may see for this library, or an empty list when the library itself
 * is hidden.
 */
export function visibleEntryLevels(
    audience: LibraryAudience,
    libraryVisibility: LibraryVisibility,
): LibraryVisibility[] {
    return audienceSatisfiesLevel(audience, libraryVisibility)
        ? levelsSatisfiedByAudience(audience)
        : [];
}

/**
 * SQL predicate for queries that span several owners. Access is relative to the value bound to
 * `viewerParam` (the viewer id, or null for an anonymous viewer). The owner is matched on
 * `entryAlias`.libraryUserId; otherwise the library ceiling comes from `profile` and the entry
 * level from `entryAlias`.visibility, with `followers` checked through `user_follow`.
 */
export function entryVisibilitySql(
    entryAlias = "entry",
    viewerParam = "viewerId",
): string {
    const sqlLevels = (audience: LibraryAudience) =>
        levelsSatisfiedByAudience(audience)
            .map((level) => `'${level}'`)
            .join(", ");
    const everyoneLevels = sqlLevels(LibraryAudience.Everyone);
    const followerLevels = sqlLevels(LibraryAudience.Follower);

    return `(
            ${entryAlias}.libraryUserId = :${viewerParam}
            OR EXISTS (
                SELECT 1
                FROM profile lv_profile
                WHERE lv_profile.userId = ${entryAlias}.libraryUserId
                AND (
                    (
                        lv_profile.libraryVisibility IN (${everyoneLevels})
                        AND ${entryAlias}.visibility IN (${everyoneLevels})
                    )
                    OR (
                        lv_profile.libraryVisibility IN (${followerLevels})
                        AND ${entryAlias}.visibility IN (${followerLevels})
                        AND EXISTS (
                            SELECT 1
                            FROM user_follow lv_follow
                            WHERE lv_follow.followerUserId = :${viewerParam}
                            AND lv_follow.followedUserId = ${entryAlias}.libraryUserId
                        )
                    )
                )
            )
        )`;
}
