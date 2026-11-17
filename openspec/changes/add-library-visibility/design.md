# Design

## Context

See proposal.md (Why) for the problem. The current state that shapes the approach:

- `CollectionsEntriesService.findAllByUserIdWithPermissions` and `findFavoritesByUserId` filter non-owners with `collectionsMap.collection.isPublic = true`. In TypeORM, that `where` on a loaded relation also trims each entry's `collections` to public ones, so it is both a filter and a redaction. `JournalService.getOverview` (and the heatmap built on it) reuses this method, so the journal is also empty for visitors.
- `findOneByIdOrFail` (`GET :id`, `:id/related`, `:id/platforms/icons`) and `findOneByUserIdAndGameIdOrFail` (`library/:userId/game/:gameId`) apply no rule and return every collection of the entry, private ones included.
- The "no collection or at least one public collection" rule is written as raw SQL in `statistics-ranking.service.ts` (reviews) and `NOTIFICATION_ELIGIBILITY_SQL` / `lockNotificationRoot` (reviews, activities and entries). `NotificationsLifecycleService.invalidateCollection` runs when a collection becomes private.
- `ProfileMetricsService.getStatsOverview` always queries as the owner (`(userId, userId)`), so visitors currently see totals that include everything. The report and summary services are `@Cacheable` for 1 hour and 10 minutes, with keys built from their arguments.
- Playtime (`user_playtime`, `playtime_history`) is keyed by user and game and can exist without a library entry (provider sync).
- Activities of type `COLLECTION_ENTRY` are created only per collection the entry is added to (`createOrUpdate` loops over `collectionIds`). `ActivitiesRepositoryService` nulls a private `activity.collection` for non-owners but does not filter the activity.
- The follow relation is `user_follow(followerUserId, followedUserId)` with a unique key. `FollowService.getFollowerInfo` uses the TypeORM query cache.
- The profile has no privacy settings yet. `customCoverMode` on `Profile`, updated through `PATCH /v1/profile`, is the closest precedent.
- Production data: 3,406 entries, 15 linked to a collection, 5 collections, all public.

## Goals / Non-Goals

**Goals:**

- One definition of "may this viewer see this user's game", with a TypeScript form for single-owner reads and an SQL form for multi-owner reads, used by every path listed in the spec.
- No extra round trips on hot list paths: the viewer's audience is resolved once per request, and list queries filter with `visibility IN (...)`.
- Hiding takes effect on the next read, including for cached metrics.

**Non-Goals:**

- Changing how `COLLECTION_ENTRY` activities are generated (only when the entry joins a collection). It is a separate, collection-centric behavior that this change leaves as is.
- Achievements, obtained-achievement activities, profile presence ("playing now") and the Daily game. They belong to the future Activity setting.
- Admin or moderator bypass. Admin sessions are treated as regular viewers by these public routes.
- Converting `Collection.isPublic` to the three-value level.

## Decisions

### 1. One level type, two columns

Add a string enum `LibraryVisibility { Public = "public", Followers = "followers", Private = "private" }` in `src/libraries/library-visibility.constants.ts`, and two columns: `collection_entry.visibility` and `profile.libraryVisibility`, both `varchar(16) NOT NULL DEFAULT 'public'`, exposed in Swagger as enums. The values are stored as strings, like `customCoverMode` and `CollectionEntryStatus`, so a future level (for example "mutuals") needs no schema change.

Alternatives: a nullable entry column meaning "inherit from the profile". Rejected because the user chose the ceiling model, under which "public" on the entry already means "as visible as the library allows", so a fourth "inherit" state would add nothing.

### 2. Audience and the ceiling rule

The viewer's relation to the owner is an audience: `owner`, `follower` or `everyone` (anonymous or not following). Each level requires an audience rank (`public` = everyone, `followers` = follower, `private` = owner). A game is visible when the audience rank is at least the stricter of the profile level and the entry level. The owner short-circuits to "everything".

A new `LibraryAccessService` (in `libraries`, exported for other modules) provides:

- `resolve(viewerId | undefined, ownerId) → { audience, libraryVisibility, canViewLibrary, visibleEntryLevels }`, with one query reading `profile.libraryVisibility` and, only when the viewer is signed in and is not the owner, an uncached `EXISTS` on `user_follow`. `visibleEntryLevels` is the list of entry levels the audience satisfies (`[public]`, `[public, followers]` or all three), or empty when `canViewLibrary` is false.
- `entryVisibilitySql(entryAlias, viewerParam)` → an SQL predicate for queries spanning several owners (activities, notifications): owner match, or a join on `profile` for the ceiling plus the entry level, with `followers` checked by `EXISTS (SELECT 1 FROM user_follow ...)`.

Both forms share the level-rank table in one module, and a unit test checks them against each other over all level/audience combinations.

Alternatives: per-viewer checks inside each service, which is how the current rules diverged. Joining `user_follow` in every list query, rejected because single-owner lists only need the audience once.

The follow check must bypass the TypeORM query cache, which `getFollowerInfo` uses, so that following or unfollowing applies on the next read.

### 3. Filter and redact are separate steps

List queries filter with `libraryUserId = :owner AND visibility IN (:levels)`, and short-circuit to `[[], 0]` when `canViewLibrary` is false. They no longer put any condition on `collectionsMap`, so TypeORM loads every collection of each entry. A single `redactEntriesForViewer(entries, viewerId, canViewLibrary)` then removes from `entry.collections` (that is, from `collectionsMap`) any collection that is not public, unless the viewer is the owner. Every route that returns entries to a possibly different user calls it: library, favorites, collection listing, single entry, entry by game, related entries and journal.

Single-entry reads load the entry, resolve access for its `libraryUserId`, and throw the same `HttpException("No entry found.", 404)` as a missing entry. Owned-platform icons and related entries go through the same check. The by-game route already takes the owner id.

The owner-only callers (`findOwnEntryByGameId`, `createOrUpdate`, activities validation, importer, MCP tools, connection summary, awards play context) keep using the unrestricted methods. The access-aware methods take a `viewerId`, so the difference is visible at the call site.

### 4. Collections

`CollectionsService.findOneByIdWithPermissions`, `findAllByUserIdWithPermissions` and `LibrariesService.findOneByIdWithPermissions` add the library ceiling for non-owners: a collection is visible when `isPublic && canViewLibrary`. `findAllByCollectionIdWithPermissions` keeps its collection check, now with the ceiling, and filters entries with the owner's `visibleEntryLevels`. `Collection.isPublic`, the featured-must-be-public rule and the collection limit do not change.

### 5. Writes

- `CreateUpdateCollectionEntryDto.visibility?: LibraryVisibility`. On create, the value or `public`. On update, the value if present, otherwise the stored one. This works because `createOrUpdate` spreads `possibleExistingEntry` first. `processRelatedEntries` passes the main entry's level to newly created related entries only.
- `POST /v1/collections-entries/game/:id/visibility` with `{ visibility }`, mirroring the favorite route: owner from the session, 404 when the game is not in the library, 204 on success. It updates only the column, and does not touch activities, level or achievements.
- `createForImport` and `createMissingForBatch` do not set the column, so the database default applies and existing rows are untouched.
- `UpdateProfileDto.libraryVisibility?: LibraryVisibility`, handled by `ProfileService.update`.
- When either change makes content more restrictive, call a new `NotificationsLifecycleService.invalidateLibraryContent(ownerId, entryId?)`. It invalidates the activities that reference the owner's entries (one entry, or all of them for a profile change) in the same way `invalidateCollection` invalidates its activities.

### 6. Profile response

`GET /v1/profile/:id` already receives the optional session. It adds `libraryVisibility` and `canViewLibrary` from `LibraryAccessService.resolve`. `GET /v1/profile` (own) returns `canViewLibrary: true`. Both fields are added to `ProfileResponseDto`, so clients can show "This library is private" or "Only followers can see this library" instead of an empty list.

### 7. Journal, playtime, metrics and recap

- Journal overview and heatmap work as soon as `findAllByUserIdWithPermissions` is fixed. The play log resolves access and returns 404 if the game has a hidden entry or the library is hidden.
- Playtime routes resolve access for `:userId`. When the library is hidden they return an empty result. Otherwise they exclude the games whose entry level is not in `visibleEntryLevels`, through `NOT EXISTS (SELECT 1 FROM collection_entry e WHERE e.libraryUserId = p.userId AND e.gameId = p.gameId AND e.visibility NOT IN (:levels))`. Playtime without an entry stays visible, as the spec requires.
- Profile metrics controllers take the optional session and pass a `LibraryAudienceKey` (`owner`, or the visible levels plus a fingerprint) to the services. The overview and distributions call the access-aware entry queries with the real viewer instead of `(userId, userId)`, and count collections through the access-aware collection method.
- **Cached metrics.** The report and summary keep `@Cacheable`, but their arguments gain `(audience, hiddenFingerprint)`. `hiddenFingerprint` is a short hash of the sorted game ids hidden from that audience, read with one indexed query on `collection_entry`. Hiding or showing a game changes the key, so the next read recomputes. For the owner and for a library with nothing hidden the fingerprint is constant, so cache hit rates stay the same for the usual case.
- The recap read (`getRecapByUserId`, `getRecapStatus`) resolves access first and returns 404 when the library is hidden. It then filters `playedGames` by the owner's hidden game ids after the cached read. Totals and distributions stored at generation are not recomputed (see the spec and Risks).

Alternative for metrics: filter after the cached read. Rejected because the report and summary return totals that cannot be adjusted afterwards without the per-game data.

### 8. Activities

`findLatestBy`, `findLatestExcludingTypes`, `findLatest` and `findOneById` add, for non-owners, `(activity.type <> 'COLLECTION_ENTRY' OR <entryVisibilitySql>)` with the viewer as a parameter. The following feed already caches per viewer for 5 minutes (see Risks). `findOneById` returns 404 for a hidden activity. Reactions and comments already validate access through the activity lookup used by statistics and comments. The task verifies that this lookup now goes through the access-aware read, so hidden activities are rejected as inaccessible. The existing nulling of a private `activity.collection` also applies the ceiling.

### 9. Notifications and rankings

- In `NOTIFICATION_ELIGIBILITY_SQL`, remove the collection predicate from `review` roots and from `activity.reviewId`. Replace the `activity.collectionEntryId` predicate with `entryVisibilitySql` evaluated for `inbox.recipientUserId`. Keep the `activity.collectionId` check, which is now `isPublic` plus the ceiling for the recipient.
- `lockNotificationRoot` mirrors the same rules in TypeScript through `LibraryAccessService`, for the recipient.
- `invalidateCollection` stops invalidating reviews and keeps invalidating collection activities.
- `statistics-ranking.service.ts` drops the collection predicate from review rankings.

### 10. Migration

One migration, `AddLibraryVisibility`:

1. `ALTER TABLE collection_entry ADD visibility varchar(16) NOT NULL DEFAULT 'public'` and the same for `profile.libraryVisibility`. MySQL 8 adds these instantly.
2. Backfill: `UPDATE collection_entry e SET e.visibility = 'private' WHERE EXISTS (SELECT 1 FROM collection_entry_collections_collection m WHERE m.collectionEntryId = e.id) AND NOT EXISTS (SELECT 1 FROM collection_entry_collections_collection m JOIN collection c ON c.id = m.collectionId WHERE m.collectionEntryId = e.id AND c.isPublic = 1)`. Expected to touch 0 rows in production today. It is kept so the change is safe on any database.
3. Index `IDX_collection_entry_library_visibility (libraryUserId, visibility)` for the list filter and the fingerprint query.

Down drops the index and the two columns.

### 11. Client hand-off

`handoff-clients.md` follows `add-custom-game-covers/handoff-clients.md`: it is written at the end from the implemented DTOs, states that the client work is a separate change in `game-node-clients`, and covers:

- the contract: levels, the new and changed fields, the visibility route, 404 semantics, empty-page semantics and the profile fields
- regenerating `input/server_swagger.json` and `pnpm wrapper:generate`
- **per-game control**: a visibility select in the entry form (`CollectionEntryFormDetailsPanel`) and a quick action next to favorite, using the dedicated route with optimistic update and rollback, and a visibility indicator on the owner's own cards
- **Privacy settings**: enable the "Library and collections" row in `SettingsPrivacyVisibilitySection` with the three levels, while Profile and Activity stay "Coming soon". Update the row copy, which today says "Default for new collections", to describe the ceiling. Update the collection form switch description to say it does not hide the games.
- **profile views**: use `canViewLibrary` and `libraryVisibility` for empty states, replace `noPublicFavoriteGames`, and stop showing private collections that a stale cache might still hold
- query keys: include the viewer in keys of other users' library and metrics queries, invalidate profile and library queries after follow or unfollow and after a visibility change, and treat 404 on another user's entry as "not visible"
- mobile and web parity, `en.json` and `pt-BR.json` keys, and a `web`/`mobile` changeset

## Risks / Trade-offs

- [Visitors suddenly see libraries that were empty for them] → This is the intended fix. The backfill keeps everything that was hidden hidden, and the Privacy setting ships in the clients right after the server.
- [The following feed caches per viewer for 5 minutes, so a newly hidden `COLLECTION_ENTRY` activity can stay in someone's following feed for up to 5 minutes] → Accepted. Single-activity reads, reactions, the journal and the library apply the change at once. If this proves to be a problem, add the owner's hidden fingerprint to the feed cache key.
- [Recap totals and distributions still count hidden games] → Accepted and stated in the spec. They are anonymous counts generated once a year. The played games list and access to the recap are enforced.
- [Old clients keep calling routes that now return 404 for hidden entries] → They already handle 404 for missing entries. Old clients also never send `visibility`, which leaves the stored value unchanged.
- [An extra profile read, and possibly a follow check, on public library routes] → Both are primary-key or unique-index lookups, once per request. List queries gain an indexed `IN` filter and lose a join on collections.
- [The SQL and TypeScript forms of the rule could drift] → Both live in one module, with a table-driven test over every level and audience combination.
- [Reviews of hidden games reveal that the user played the game] → This was the user's explicit choice ("reviews always public"). The hand-off asks clients to say so next to the visibility control.

## Migration Plan

1. Deploy the migration and the server code together. Existing clients keep working: new fields are additive, and nothing they send changes visibility.
2. Check after deploy: the backfill row count (expected 0), and that `collections-entries/library/<id>` for `gotaserena`, `Andromeda` and `medicodosus` now returns their entries anonymously.
3. Ship the clients through a separate change in `game-node-clients` based on `handoff-clients.md`.

Rollback: revert the code and run the migration down. The per-game and profile settings are lost, and the old collection-based rule comes back with the code. No other data is affected.
