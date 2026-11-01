# Tasks

## 1. GameNode-owned mappings (origin, reserved IDs, categories)

- [x] 1.1 Add `origin` (`igdb` | `bulk` | `curated`, default `igdb`) to `GameExternalGame`, plus a migration (`src/migrations/<ts>-AddExternalGameOrigin.ts`) whose down step deletes non-`igdb` rows before dropping the column. Verify that `yarn migration:run` succeeds locally and that every existing row has `origin = 'igdb'`.
- [x] 1.2 Add `EpicGamesNamespace = 1001` to `EGameExternalGameCategory`, with a one-line comment that values from 1000 up are GameNode-only. Verify `yarn build` passes.
- [x] 1.3 Add a reserved-ID insert helper to `ExternalGameService`: `GREATEST(1e12, MAX(id) + 1)` over the reserved range, with a retry on `ER_DUP_ENTRY` (at most 5) and the `shortcut:` comment from design D1/Risks. Verify with a test in `external-game.service.spec.ts` that a new row gets an ID of at least 1e12 and that a duplicate-key collision is retried.
- [x] 1.4 Rewrite `ExternalGameService.submit` as in design D4: 409 when an `igdb` row maps the same `(uid, category)`, update an existing non-IGDB row, otherwise insert a `curated` row, and keep the unmapped-entry deactivation. Verify that `external-game.service.spec.ts` covers the scenarios "Adding a second mapping", "Correcting a curated mapping", "Shadowing an IGDB mapping" and "Resolving an unmapped entry".

## 2. IGDB sync preserves GameNode rows

- [x] 2.1 In `GameRepositoryCreateService.handleManyToMany`, for `externalGames` only, select `origin` and filter the existing data to `igdb` before the checksum comparison and the removal diff. Verify with a test in `game-repository-create.service.spec.ts` that a game with a `curated` row, synced with an IGDB list that doesn't contain it, keeps the row and still reconciles its IGDB rows. Also verify that the unchanged IGDB rows plus a curated row do not trigger a reconciliation.

## 3. Shared importer matching

- [x] 3.1 Extract `matchUnprocessed(userId, includeMarked, sourceIds, category, platformFor)` in `importer.service.ts` and route the Steam, PSN and Xbox methods through it, with no behavior change. Verify that the existing `importer.service.spec.ts` passes unchanged, and add one case for `includeMarked = true` that returns processed entries.

## 4. Delegated-code onboarding

- [x] 4.1 Allow `authMode` `delegated_code` in `ConnectionsService.initRedirectAuth` and `completeRedirectAuth`, and delete `exchangeDelegatedCode` from `ConnectionProviderAuthStrategy`. Verify that `connections.service.spec.ts` covers: a delegated-code provider completes init and callback, consumes the state and stores credentials; `POST /v1/connections` with a delegated-code type returns 400; `psn` init still returns 400.

## 5. Epic Games provider

- [x] 5.1 Move the Redis lock helpers (`acquire`, `renew`, `release`) from `XboxSyncAuthService` into `src/sync/connection-token-lock.ts` and use them from Xbox. Verify that `xbox-sync-auth.service.spec.ts` passes unchanged.
- [x] 5.2 Add `EConnectionType.EPIC_GAMES = "epicgames"` and include it in the importer, importer-watch and playtime lists. Register it in `ConnectionProviderRegistry` with `authMode: DELEGATED_CODE`. Add `EImporterSource.EPIC_GAMES` and the mapping branches in `importer.util.ts` and `playtime.util.ts`. Add `EPIC_OAUTH_CLIENT_ID` and `EPIC_OAUTH_CLIENT_SECRET` to `.env.example`. Verify that `connection-provider.registry.spec.ts` asserts the `epicgames` metadata and capability flags from the registry spec delta.
- [x] 5.3 Create `src/sync/epic/` with `EpicSyncModule` and `EpicConnectionAuthProvider`: login URL on init; on callback, parse the code (raw 32-hex, or JSON with `authorizationCode`, anything else a 400), exchange it, and return the account, display name and credentials. Register it in `ConnectionsModule`. Verify with `epic-connection-auth.provider.spec.ts`: a raw code, the JSON body, a malformed input (400), and an Epic rejection (400, no credentials).
- [x] 5.4 Add `EpicSyncAuthService.getAccessToken(accountId)`: reuse the token when it is valid for more than 5 minutes, otherwise refresh under the lock and save the rotated tokens. An invalid refresh token or a missing one sets `REAUTH_REQUIRED` and throws `ProviderSyncError("reauth_required")`. Verify with `epic-sync-auth.service.spec.ts`: a valid token is reused, two concurrent callers send one refresh, and a revoked refresh token sets `reauth_required`.
- [x] 5.5 Add `EpicSyncService.getLibraryItems` (follows cursor pages, drops `ue`) and `getPlaytime`, both using `providerCall("epicgames:user:<accountId>", ...)`. Verify with `epic-sync.service.spec.ts`: two pages are merged, `ue` is dropped, and the budget key is per account.
- [x] 5.6 Register Epic `fetchLibraryGames` in `ImporterService` through `matchUnprocessed` (namespaces, `EpicGamesNamespace`, platform 6), registering unmapped namespaces. Verify with `importer.service.spec.ts`: a base game and its add-ons in one mapped namespace yield one item on platform 6, and an unmapped namespace is registered.
- [x] 5.7 Register Epic `fetchPlaytime` in `PlaytimeWatchProcessor`: map appName to namespace to game, sum per game, upsert with source `EPICGAMES` on platform 6, set `lastPlayedDate = now` only when the total increased, and add the `shortcut:` comment from design D9. Verify with `playtime-watch.processor.spec.ts`: the first import stores the total without a last played date, an increased total sets last played, and an app missing from the library is skipped.

## 6. Epic namespace bulk fill

- [x] 6.1 Register the `external-game-mapping` queue and the `epic-namespace-fill` processor as in design D5: paged by ascending ID with a `lastId` cursor in the job data, slug extraction, sequential content API calls with a pause and a timeout, main-game resolution, `bulk` inserts that never overwrite existing rows, unmapped registration for ambiguous namespaces, and a run summary as the return value. Verify with a processor spec: the unambiguous, ambiguous, base-plus-add-ons, existing-curated and unresolvable-slug scenarios from the external-game-mapping spec, plus resuming from `lastId`.
- [x] 6.2 Add `POST /v1/game/external/fill/epic` (`ADMIN`), which adds the job with the fixed `jobId` and returns `{ jobId, state }`. Verify with a controller spec that non-admins are rejected and that a second trigger while the job is active reports the existing job.

## 7. Integration checks

- [x] 7.1 Run `yarn build`, `yarn lint` and `yarn test` for `src/connection`, `src/importer`, `src/playtime`, `src/game/external-game`, `src/game/game-repository/create` and `src/sync`. Verify that they all pass.
- [x] 7.2 Start the app so that `server_swagger.json` is regenerated, and confirm the diff shows `epicgames` support and the new admin endpoint.
- [x] 7.3 Do a manual end-to-end run against a real Epic account in a local environment: init, paste the code, callback, list unprocessed entries, run a playtime refresh, and trigger the bulk fill. Record any endpoint differences from design D8 in design.md.

## 8. Re-auth notification and notification DTO fixes

- [ ] 8.1 Add `connection.reauth-required` with payload `{ connectionId, provider }` to `notifications.types.ts`, outbox payload validation and the projector, plus a `NotificationConnectionTargetDto`, as in design D10. Verify with outbox and projector specs: a valid payload passes, an extra key fails, the projected item has the `connection` target and provider preview text, and a deleted connection is suppressed.
- [ ] 8.2 Add `markReauthRequired(manager, connection)` in `src/connection/` and use it from Epic's `requireReauth` and Xbox's three `reauth_required` changes, inside a transaction. Verify with tests: the first change creates one intent, a repeat or concurrent call creates none, and `epic-sync-auth.service.spec.ts` and `xbox-sync-auth.service.spec.ts` still pass.
- [ ] 8.3 Add `epicgames` to the provider enums of `NotificationImporterTargetDto` and the import preview DTO (design D11), and regenerate `server_swagger.json`. Confirm that the diff shows the `epicgames` enums, the `connection` target, and nothing unrelated.
- [ ] 8.4 Generate the client hand-off at `openspec/changes/add-epic-games-connection/handoff-clients.md` for `game-node-clients` (branch `feat/add-epic-connection`). It must be self-contained and list:
  - a `connection.reauth-required` branch in `packages/ui/src/components/notifications/AggregatedNotification.tsx` with the provider icon (`getServerStoredIcon(provider)`) and translated text in `@repo/locales`;
  - `handleItemClick` routing a `connection` target to `/preferences/connections`;
  - an "Epic Games" display name for `epicgames` in import notifications instead of the capitalized "Epicgames";
  - the paste-code UI for `delegated_code` providers, if it is not already done on that branch;
  - a mobile test next to `apps/mobile/src/components/notifications/import-discovery-notification.test.tsx`;
  - regenerating the API wrapper from the updated `server_swagger.json`.
  Verify that every file path and route it names exists in `game-node-clients`.

## Workflow follow-up

- Hand the client work in `game-node-clients` over through the hand-off from task 8.4.
- Archive the change after review.
