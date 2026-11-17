# Proposal

## Why

The privacy of a library game today depends on how the game is organized. For a non-owner, `GET /v1/collections-entries/library/:id` and the favorites listing return only entries that sit in at least one public collection. Only 15 of 3,406 entries in production belong to any collection, so almost every library, and the journal built from it, is empty for visitors. Other paths use different rules: review rankings and notifications treat an entry with no collection as visible, while the single-entry routes do not filter anything and return the names of private collections. Users have no explicit way to say who can see their games. The Privacy settings screen shows a "Library and collections" control that is disabled and marked "Coming soon".

## What Changes

- Separate collection privacy from game visibility. `Collection.isPublic` decides only whether the collection itself (its name, description, page and membership list) is visible. It no longer hides the games in it.
- Add `collection_entry.visibility` with the values `public`, `followers` and `private`. It defaults to `public`. The owner can set it when creating or updating an entry and through a dedicated endpoint.
- Add `profile.libraryVisibility` with the same three values, defaulting to `public`. It acts as a ceiling on the library: a game is visible to a viewer only when both the profile setting and the game's own setting allow it. The owner always sees everything.
- "Followers" means users who currently follow the owner. Following or unfollowing takes effect on the next read.
- Apply one access rule to every read that exposes a user's games: library and favorites listings, collection pages, single-entry and per-game routes, related DLC entries, owned-platform icons, the journal, playtime, profile metrics, the year recap, `COLLECTION_ENTRY` activities (feed, single activity and interactions) and notification eligibility. Collections become visible to a non-owner only when they are public **and** the viewer may see the library.
- Strip private collections from the `collections` array of entries returned to non-owners. This closes the current leak of private collection names on single-entry routes.
- Reviews stay public whatever the visibility of their entry. Remove the collection-based review filter from rankings and from notification eligibility.
- Expose `libraryVisibility` and the viewer-relative `canViewLibrary` on profile reads, so clients can explain why a library is hidden.
- **BREAKING (behavior)**: visitors start seeing games that are in no collection, which are the large majority. Entries that were hidden only because all of their collections are private are migrated to `visibility = private`, so nothing that was hidden before becomes visible.
- Generate a client hand-off (`handoff-clients.md`) for `game-node-clients` as the last task. Client implementation is not part of this change.

Not included: the Profile and Activity rows of the Privacy settings screen; the visibility of achievements and their activities; turning `Collection.isPublic` into a three-value setting; follow requests or approval; blocking. Anonymous aggregates over all users (game popularity, player counts, review scores) are unchanged.

## Capabilities

### New Capabilities

- `library-visibility`: who may see a user's library games and collections, the per-entry and per-profile settings, the rule that combines them, and how every read path that exposes a user's games applies it.

### Modified Capabilities

None. The existing `notification-inbox`, `popularity-rankings`, `engagement-statistics` and `content-reactions` requirements already refer to "current access rules" in general terms. This change defines those rules for library content in `library-visibility` without changing their requirements.

## Impact

- **Data**: new columns `collection_entry.visibility` and `profile.libraryVisibility`, with a migration that backfills `private` for entries whose collections are all private.
- **APIs**: new optional `visibility` in `CreateUpdateCollectionEntryDto`; new `POST /v1/collections-entries/game/:id/visibility`; new `libraryVisibility` in `UpdateProfileDto`; new `libraryVisibility` and `canViewLibrary` in the profile response; `visibility` in collection entry responses. Several public routes start taking the optional session into account and return 404 for hidden single entries.
- **Code**: `collections` (entries service, collections service), `libraries`, `profile` and `profile-metrics`, `journal`, `playtime`, `recap`, `activities` (repository and feed), `notifications-lifecycle`, `statistics-ranking`, `follow` (uncached existence check).
- **Clients**: regenerate `server_swagger.json`. Clients add a per-game visibility control and enable the library row in Privacy settings, as described in the hand-off.
