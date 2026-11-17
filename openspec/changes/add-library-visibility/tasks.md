# Tasks

## 1. Data model and access rule

- [x] 1.1 Add the `LibraryVisibility` enum and level/audience rank table (design 1, 2), `collection_entry.visibility` and `profile.libraryVisibility` on the entities, and the `AddLibraryVisibility` migration with the backfill and the `(libraryUserId, visibility)` index (design 10). Verify that the migration runs up and down on a clean database, and with an integration test that an entry only in private collections is backfilled `private` while entries with no collection or with a public collection stay `public`.
- [x] 1.2 Implement `LibraryAccessService.resolve` with an uncached follow existence check, and `entryVisibilitySql` (design 2), exported from the libraries module. Verify with a table-driven unit test over every profile level × entry level × audience (owner, follower, signed-in non-follower, anonymous) that both forms agree, and with an integration test that a follow and an unfollow change the result on the next call.

## 2. Writes

- [x] 2.1 Add the optional `visibility` to `CreateUpdateCollectionEntryDto` and handle it in `createOrUpdate`, defaulting to `public` on create, keeping the stored value on update, and applying the parent's level to related entries created in `processRelatedEntries` (design 5). Verify with `collections-entries.service.spec.ts`: create without a level, create with `followers`, update without a level keeps `private`, an invalid value returns 400, a new DLC inherits the level and an existing DLC keeps its own.
- [x] 2.2 Add `POST /v1/collections-entries/game/:id/visibility` (design 5). Verify with controller and service tests for 204, 400, 401, 404 when the game is not in the library, and that no activity, level or achievement job is registered.
- [x] 2.3 Add `libraryVisibility` to `UpdateProfileDto` and `ProfileService.update`. Verify with `profile.service.spec.ts` the default, a valid update, 400 for an invalid value, and that other fields are unchanged.
- [x] 2.4 Confirm that `createForImport`, `createMissingForBatch` and the importer leave `visibility` untouched. Verify with an importer test that re-importing a game already stored as `private` keeps it `private`, and that a new imported entry is `public`.

## 3. Library, favorites, collections and single entries

- [x] 3.1 Rewrite `findAllByUserIdWithPermissions` and `findFavoritesByUserId` to filter with `visibleEntryLevels`, short-circuit hidden libraries, and redact collections through `redactEntriesForViewer` (design 3). Verify with service tests: a visitor sees a `public` entry in no collection, a `public` entry only in a private collection with that collection removed from `collections`, no `followers` entry as anonymous, the `followers` entry as a follower, an empty page with total 0 for a hidden library, correct totals with status and `hasCustomCover` filters, and everything for the owner.
- [x] 3.2 Apply access and redaction to `GET :id`, `:id/related`, `:id/platforms/icons` and `library/:userId/game/:gameId`, passing the optional session from the controller (design 3). Verify with tests that a hidden entry returns the same 404 body as a missing one, that related entries omit hidden DLCs, and that a visible entry lists no private collections for a visitor.
- [x] 3.3 Add the library ceiling to `CollectionsService.findOneByIdWithPermissions`, `findAllByUserIdWithPermissions`, `LibrariesService.findOneByIdWithPermissions` and `findAllByCollectionIdWithPermissions`, filtering collection entries by visibility (design 4). Verify with `collections.service.integration.spec.ts`: a public collection in a `private` library returns 404 and is absent from lists, a private collection returns 404, a public collection hides its `private` entry from a visitor, and the owner sees everything. Update the existing tests that asserted the old collection-based rule.
- [x] 3.4 Add `libraryVisibility` and `canViewLibrary` to `ProfileResponseDto`, filled for `GET /v1/profile/:id` from the session and for `GET /v1/profile` as the owner (design 6). Verify with `profile.controller.spec.ts` for an anonymous viewer, a follower, a non-follower and the owner.

## 4. Journal, playtime, metrics and recap

- [x] 4.1 Make the journal overview, heatmap and play log access-aware (design 7). Verify with tests that a visitor's overview and heatmap include only visible games, and that the play log of a hidden game returns 404.
- [x] 4.2 Make the public playtime routes access-aware, with the entry-level exclusion and playtime without an entry kept (design 7). Verify with tests: a hidden game's playtime is excluded from the per-game, list, filtered and accumulated routes; playtime with no entry is visible in a `public` library; a `private` library returns empty results.
- [x] 4.3 Pass the session to the profile metrics controllers. Compute the overview and distributions with the viewer's access, and add `(audience, hiddenFingerprint)` to the cached report and summary arguments (design 7). Verify with tests that a visitor's overview counts only visible games and collections, that a hidden library returns zeros, that hiding a game changes the summary on the next read with no wait for the TTL, and that the owner's numbers are unchanged.
- [x] 4.4 Gate `GET recap/:year/:userId` and its status route on `canViewLibrary`, and filter `playedGames` by hidden game ids after the cached read (design 7). Verify with tests: 404 for a `private` library, a hidden game absent from `playedGames`, and the full recap for the owner.

## 5. Activities, notifications and rankings

- [x] 5.1 Add the `COLLECTION_ENTRY` visibility predicate to the activity listings, the feeds and `findOneById`, and apply the ceiling where a private `activity.collection` is nulled (design 8). Verify with `activities-repository.service.spec.ts` and an integration test that a follower's following feed and the general feed omit an activity about a `private` entry, that the owner still sees it, and that `findOneById` returns 404 to a visitor.
- [x] 5.2 Make sure likes and comments on activities go through the access-aware lookup. Verify with integration tests that liking or commenting on an activity about a `followers` entry as a non-follower fails, without creating statistics, reactions or notification intent.
- [x] 5.3 Update `NOTIFICATION_ELIGIBILITY_SQL` and `lockNotificationRoot`: remove the review collection predicate, use the entry rule for the recipient on `collectionEntryId`, and keep the collection activity check with the ceiling. Stop invalidating reviews in `invalidateCollection`, and add `invalidateLibraryContent`, called from the visibility route, `createOrUpdate` and the profile update when a level becomes stricter (design 5, 9). Verify with `pnpm test:notifications`: a review of an entry only in private collections stays eligible, and a follower's notification about an activity on an entry that becomes `private` stops exposing that context on the next inbox read. Update the integration specs that asserted the old rule.
- [x] 5.4 Remove the collection predicate from review rankings in `statistics-ranking.service.ts` (design 9). Verify with `pnpm test:statistics`, updating `statistics-ranking.integration.spec.ts`, that a review of an entry only in private collections is ranked.

## 6. Integration and client hand-off

- [x] 6.1 Run `pnpm test:typecheck`, `pnpm test:notifications`, `pnpm test:statistics` and the unit suites for `src/collections`, `src/libraries`, `src/profile`, `src/journal`, `src/playtime`, `src/recap` and `src/activities`. Confirm the application boots with no new provider cycle (`LibraryAccessService` must not import `CollectionsEntriesService`).
- [x] 6.2 On a copy of production data, or with the anonymous API after deploy, check that `collections-entries/library/<id>` returns the entries of `gotaserena` (39), `Andromeda` and `medicodosus`, and that the backfill updated the expected number of rows (0 today).
- [x] 6.3 Regenerate `server_swagger.json` and write `handoff-clients.md` in this change with everything listed in design 11. State that client implementation is a separate change in `game-node-clients`. Verify that every route, field, status code and enum value in the document matches the implemented DTOs.

## Workflow follow-up

- Archive the change after the hand-off is delivered and the implementation is reviewed.
