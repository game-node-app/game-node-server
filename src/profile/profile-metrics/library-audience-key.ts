import { createHash } from "node:crypto";
import {
    LibraryAccess,
    LibraryAudience,
    LibraryVisibility,
    LIBRARY_VISIBILITY_LEVELS,
} from "../../libraries/library-visibility.constants";
import { LibraryAccessService } from "../../libraries/library-access.service";

/**
 * What the cached profile metrics depend on besides the owner: the entry levels the viewer may
 * see and a short hash of the games hidden from them, so hiding a game changes the cache key.
 */
export type LibraryAudienceKey = {
    audience: LibraryAudience;
    visibleEntryLevels: LibraryVisibility[];
    hiddenFingerprint: string;
};

/** Constant when no game is hidden, so the usual cache entry keeps being shared. */
const NO_HIDDEN_GAMES = "none";
/** Every viewer of a hidden library sees zeros, so they can share one entry. */
const HIDDEN_LIBRARY = "all";

/** Owner-only callers that omit the audience keep the owner's numbers. */
export const OWNER_LIBRARY_AUDIENCE_KEY: LibraryAudienceKey = {
    audience: LibraryAudience.Owner,
    visibleEntryLevels: [...LIBRARY_VISIBILITY_LEVELS],
    hiddenFingerprint: NO_HIDDEN_GAMES,
};

export async function resolveLibraryAudienceKey(
    libraryAccessService: LibraryAccessService,
    ownerId: string,
    access: LibraryAccess,
): Promise<LibraryAudienceKey> {
    return {
        audience: access.audience,
        visibleEntryLevels: access.visibleEntryLevels,
        hiddenFingerprint: access.canViewLibrary
            ? hiddenGamesFingerprint(
                  await libraryAccessService.hiddenGameIds(
                      ownerId,
                      access.visibleEntryLevels,
                  ),
              )
            : HIDDEN_LIBRARY,
    };
}

/** Short hash of the ids, which LibraryAccessService returns sorted ascending. */
export function hiddenGamesFingerprint(hiddenGameIds: number[]): string {
    if (hiddenGameIds.length === 0) return NO_HIDDEN_GAMES;
    return createHash("sha1")
        .update(hiddenGameIds.join(","))
        .digest("hex")
        .slice(0, 12);
}
