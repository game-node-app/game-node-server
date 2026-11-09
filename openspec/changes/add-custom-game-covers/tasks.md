# Tasks

## 1. Data model

- [x] 1.1 Add the `GameCoverOption` and `UserGameCover` entities, `versionParentId` and `versionTitle` on `Game`, and `customCoverMode` on `Profile` (design 1), with a raw-query migration that adds the `game.versionParentId` foreign key with foreign key checks off (design Risks); verify the migration runs up and down on a clean database with the unique keys and cascade foreign keys present.

## 2. IGDB ingestion

- [x] 2.1 Add `version_parent` and `version_title` to `IGDB_CATALOG_FIELDS`, remove them from `IGDB_CATALOG_UNUSED_SOURCE_FIELDS`, store them on import only when the parent exists, and declare the `compare` field on the `games` endpoint (design 8); verify with `igdb-catalog.fields.spec.ts` and refresh tests that a differing link refreshes the edition, an absent parent does not, and no placeholder game is created.
- [x] 2.2 Upsert `edition` options after the base game write (design 8); verify with `yarn test:igdb:integration` that an edition and its base get options, a replaced edition cover keeps the same option row and user choices, a replayed import creates no duplicates, and a game with no editions gets none.
- [x] 2.3 Add `sweepFields` to `SyncEndpoint` and `fetchSweepPage`, and implement `IgdbCoverOptionService.syncPage` with the classification, expanded fetch and ownership-guarded writes (design 7), called by the runner; verify with unit and integration tests the localized, alternative, historical and unrelated-artwork cases, a primary cover staying on the normal path, an unchanged source making no fetch, an absent game being skipped, a changed checksum keeping user choices, and replay creating no duplicates.
- [x] 2.4 Confirm option rows no longer refresh their parent game; verify with a sweep test over a page containing a localized and a historical cover that `fetchByIds` is not called on the `games` endpoint for them, and that the existing in-place primary cover scenario still passes.

## 3. Cover options and choices API

- [x] 3.1 Create the game cover module with `GET /v1/game/cover/:gameId/options` and its family query (design 6); verify with an integration test the base game, edition page, empty list, duplicate-image exclusion and 404 cases.
- [x] 3.2 Add `GET`, `PUT` and `DELETE /v1/game/cover/:gameId/mine` with DTO validation and eligibility checks (design 6); verify with tests for 200, 400, 401 and 404, replacing a choice, removing a missing choice, a game outside the library, and an unchanged `collection_entry.updatedAt`.
- [x] 3.3 Add `customCoverMode` to `UpdateProfileDto` and `ProfileService.update`; verify with `profile.service.spec.ts` the default, a valid update, an invalid value returning 400, and that other fields are unchanged.
- [x] 3.4 Verify in the account deletion test that a deleted user's choices are removed, and that the existing deletion flow still passes.

## 4. Effective cover on game reads

- [x] 4.1 Implement `GameCoverService.applyEffectiveCovers` with the resolution order (design 5); verify with an integration test every scenario in the Effective cover resolution requirement, including unknown owners and games with no default cover.
- [x] 4.2 Add `personalizeCovers` and `coverOwnerUserId` to the find DTOs and apply them in both game repository handlers, resolving the session only on opt-in and passing only `{ gameIds | id, relations }` to the cached methods (design 3, 4); verify with controller tests that a read without opt-in or without the cover relation never calls `getSession` or reads choices, an invalid session behaves as anonymous, and cache keys match today's.
- [x] 4.3 Verify response isolation with a test against the real `@Cacheable` path: a personalized read followed by a non-personalized read returns the default cover, a changed choice appears on the next read, and the personalized `cover` has the same fields as a default one.

## 5. Library filter

- [x] 5.1 Add `hasCustomCover` to `FindCollectionEntriesDto` and apply it in the library, favorites and collection listings (design 9), with the `shortcut:` comment; verify with `collections-entries.service.spec.ts` the own library, an owner with no choices, a collection listing, and that entries only in private collections stay hidden from another viewer.

## 6. Integration and client hand-off

- [x] 6.1 Run `yarn test:typecheck`, `yarn test:igdb:unit`, `yarn test:igdb:integration` and the unit suites for `src/game` and `src/collections`, and confirm the application boots with no new provider cycle.
- [x] 6.2 Regenerate `server_swagger.json` and write `handoff-clients.md` in this change with all contents listed in design 10, stating that client implementation is a separate change in `game-node-clients`; verify every endpoint, field and status in the document matches the implemented DTOs and that it contains no credential values.

## Workflow follow-up

- Archive the change after the hand-off is delivered and the implementation is reviewed.
