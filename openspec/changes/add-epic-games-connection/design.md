# Design

## Context

Motivation: see proposal.md, Why. Requirements: see the four spec deltas.

What shapes the approach:

- **Downstream tables reference `game_external_game.id` by foreign key.** Six entities do: importer processed, ignored and notified entries, importer notifications, `player_game_sync`, obtained achievements and their activity, and game completion status. Anything that maps a source ID to a game has to end up as a `game_external_game` row, or all of these have to change.
- **How the IGDB catalog sync handles external games.** `GameRepositoryCreateService.handleManyToMany` loads a game's external games (`select { id, checksum }`), compares checksums, then calls `addAndRemove(incomingNotInExisting, existingNotInIncoming)`. Any row that IGDB didn't send counts as "existing not in incoming", so a GameNode row on that game would be dropped and would also force a reconciliation every time.
- **IGDB ID formats.** IGDB's Epic rows (category 26, 10,574 rows across 8,602 games) carry either the Epic **offer ID** (32 hex characters) or a store page document ID (a dashed UUID). I verified the offer ID against Epic's store content API for Hades, Fortnite and Rocket League. IGDB's `url` contains the store page slug in both URL forms: `https://store.epicgames.com/en-US/p/<slug>` and `https://www.epicgames.com/store/p/<slug>`. `GET https://store-content-ipv4.ak.epicgames.com/api/en-US/content/products/<slug>` needs no login and returns the product's `namespace`.
- **The current `ExternalGameService.submit` is wrong in two ways.** It assigns a random ID below 1,000,000, a range that holds 110,543 IGDB rows. It also finds the row to overwrite by `(category, gameId)`, so a second mapping for a game replaces the first.
- **Existing building blocks to reuse:**
  - the registry dispatch (`fetchLibraryGames` and `fetchPlaytime`),
  - `ConnectionCredentialService` for AES-GCM token storage,
  - `providerCall`, `uncancellableProviderCall` and `PlayerProviderBudgetService`, which accept any `<registered type>:<scope>` key,
  - `ProviderSyncError("reauth_required")` with the `PlayerSyncStateService` handling,
  - `UnmappedExternalGame` and `registerUnmappedGame`,
  - `UserPlaytimeSource.EPICGAMES`, which already exists.
- **The Epic endpoints are unofficial.** I took them from the open-source launchers Legendary and Heroic, which use them:
  - Token: `POST https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token` (HTTP Basic auth with the launcher client, `token_type=eg1`). It returns `access_token`, `expires_at`, `refresh_token`, `refresh_expires_at`, `account_id` and `displayName`.
  - Login URL that displays a code: `https://www.epicgames.com/id/login?redirectUrl=<encoded https://www.epicgames.com/id/api/redirect?clientId=<id>&responseType=code>`. It shows JSON containing `authorizationCode`.
  - Library: `GET https://library-service.live.use1a.on.epicgames.com/library/api/public/items?includeMetadata=true&cursor=<c>`. It returns `records[{ namespace, catalogItemId, appName, ... }]` and `responseMetadata.nextCursor`.
  - Playtime: `GET https://library-service.live.use1a.on.epicgames.com/library/api/public/playtime/account/<accountId>/all`. It returns `[{ artifactId (= appName), totalTime (seconds) }]`.

## Goals / Non-Goals

**Goals:**

- One mapping store that every downstream table can reference without schema changes.
- Epic library and playtime import matching the quality of Xbox: per-user tokens, `reauth_required` and per-user budgets.
- Every existing provider behaves the same after the importer refactor.

**Non-Goals:**

- Folding `PsnExtraMappings` into the new origin model.
- A title-matching engine. This change only adds the store and the bulk fill for Epic.
- Letting moderators override `igdb` rows.
- Epic last-played precision beyond "changed since the last sync".

## Decisions

### D1. GameNode mappings live in `game_external_game` with an `origin` column

Add a `origin varchar(16) NOT NULL DEFAULT 'igdb'` column (`igdb` | `bulk` | `curated`). Non-IGDB rows get IDs from `>= 1_000_000_000_000`. That is far above IGDB's current maximum (about 3.2 million) and still a safe JavaScript integer. A row's ID is allocated as `GREATEST(1e12, MAX(id) + 1)` over that range, and the insert is retried on `ER_DUP_ENTRY`, at most five times. This lives in one helper inside `ExternalGameService`.

- *Alternative: a separate `external_game_mapping` table.* That is cleaner on paper, but every foreign key consumer above would need a second key or a polymorphic reference, and every lookup would need two queries. Rejected, because the blast radius is far larger than the benefit.
- *Alternative: a separate table that is copied into `game_external_game`.* That stores the same fact twice and keeps the copies in sync by hand. Rejected.
- *Alternative: negative IDs.* `bigint` is signed, so these would work, but they read as bugs and are harder to allocate. Rejected.

### D2. The IGDB sync only reconciles `igdb` rows

In `handleManyToMany`, for `externalGames` only, add `origin` to the select. Filter `existingData` to `origin = 'igdb'` before `hasChecksumChanged` and before computing `existingNotInIncoming`. Every other relation path stays unchanged.

### D3. GameNode-only categories start at 1000

Add `EpicGamesNamespace = 1001` to `EGameExternalGameCategory`, with a one-line comment that values from 1000 up are GameNode-only. IGDB's highest source value today is 121. Lookups stay `(uid, category)` on the existing index, so no lookup logic needs to know about origins. `submit` and the bulk fill never create a non-IGDB row whose `(uid, category)` already exists as an `igdb` row, so a lookup never sees conflicting origins.

### D4. Correct `submit`

`submit` does the following:

1. Look for rows with the same `(uid, category)`.
2. If one is `igdb`, respond 409.
3. If one is non-IGDB, update its `gameId` and `url`.
4. Otherwise insert a `curated` row with a reserved ID.

The unmapped-entry deactivation stays as it is. The DTO is unchanged.

### D5. Epic namespace bulk fill is one BullMQ job

- **Queue and trigger.** A new queue `external-game-mapping`, with job name `epic-namespace-fill` and fixed `jobId` `epic-namespace-fill`. It uses `removeOnComplete` and `removeOnFail`, so a finished run doesn't block the next one, while an active or waiting job dedupes a second trigger. `POST /v1/game/external/fill/epic` (`ADMIN`) adds the job and returns `{ jobId, state }`.
- **Processor:**
  1. Page through `category = 26` rows with a non-null `url`, by ascending `id`, in batches of 500. Keep `lastId` in `job.data` through `job.updateData`, so a retried job resumes where it stopped.
  2. Extract the slug with `/\/p\/([^/?#]+)/`, deduplicate, and fetch the content API for each slug in sequence, with a 200 ms pause and a 15-second timeout per request.
  3. Group the candidate `gameId`s by namespace.
- **Resolution per namespace:**
  1. Drop candidates whose `Game.category` is `DlcAddon`, `Expansion`, `Bundle`, `Pack` or `Update`.
  2. If exactly one game remains, or the namespace had exactly one candidate to begin with, write a `bulk` row (`uid = namespace`, `category = 1001`, `url = store page`), unless a row for that namespace already exists. An existing `curated` or `bulk` row is never overwritten.
  3. Otherwise, register the namespace as unmapped.
- **Run summary.** The run returns `{ slugs, resolved, failed, mapped, ambiguous }` as its job return value.
- *Alternative: resolve namespaces at import time from the user's library.* That would put many content API calls into every user's sync and still not deal with ambiguity. Rejected. Unmapped namespaces still reach moderators through the importer.

### D6. Shared importer matching

- **Shared method.** Extract the common body of the three `findUnprocessed*Entries` into one private method:
  `matchUnprocessed(userId, includeMarked, sourceIds, category, platformFor: (externalGame) => number)`.
  It does the processed-entry filter, `getExternalGamesForSourceIds`, the ignore filter, and maps each result to an `ImporterResponseItemDto`.
- **What each provider keeps:**
  - Steam passes `() => 6`.
  - PSN and Xbox keep their platform lookup inside `platformFor`.
  - Epic passes `() => 6`.
- The registry's `fetchLibraryGames` signature doesn't change. The existing `importer.service.spec.ts` cases are the regression check.

### D7. `delegated_code` reuses the init and callback endpoints

`initRedirectAuth` and `completeRedirectAuth` accept `authMode` `redirect` or `delegated_code`. The delegated-code strategy implements:

- `initRedirectAuth`, which returns the Epic login URL. Epic shows the code on its own page and never redirects back, so the `state` is not sent to Epic. It is still created and returned.
- `completeRedirectAuth`, which reads `callbackParams.code`.

That reuses state binding, collection validation, credential persistence and sync initialization. The registry's unused `exchangeDelegatedCode` method is deleted. Clients tell the flows apart by the provider's `authMode`:

- `redirect`: navigate to the URL and come back.
- `delegated_code`: open the URL in a new tab and show a paste box.

- *Alternative: a separate `POST /:type/auth/code` endpoint.* It would duplicate the whole callback path. Rejected.

### D8. Epic provider module `src/sync/epic/`

The module mirrors `src/sync/xbox/`:

- **`EpicConnectionAuthProvider`.** On init it builds the login URL. On callback it:
  1. accepts a 32-hex code, or JSON containing `authorizationCode` (anything else is a 400);
  2. exchanges the code;
  3. returns `sourceUserId = account_id` and `sourceUsername = displayName`;
  4. returns credentials `{ accessToken, refreshToken, expiresAt, refreshTokenExpiresAt }`.
  The client ID and secret come from `EPIC_OAUTH_CLIENT_ID` and `EPIC_OAUTH_CLIENT_SECRET`.
- **`EpicSyncAuthService.getAccessToken(accountId)`.** It loads the connection by `(type, sourceUserId)` and returns the stored token if it is valid for more than 5 minutes. Otherwise it takes the per-connection Redis lock, re-reads, refreshes and saves the rotated tokens.
  - If Epic responds 400 or 401 with `errors.com.epicgames.account.auth_token.invalid_refresh_token`, or no refresh token is stored, it sets `REAUTH_REQUIRED` and throws `ProviderSyncError("reauth_required")`, the same way Xbox does.
  - The lock helpers (`acquire`, `renew`, `release`) move from `XboxSyncAuthService` into `src/sync/connection-token-lock.ts`, and both services use them. The Xbox behavior doesn't change.
- **`EpicSyncService`.**
  - `getLibraryItems(accountId)` follows the pages and drops `namespace === "ue"` (Unreal Engine marketplace).
  - `getPlaytime(accountId)` fetches the per-app playtime.
  - Every call goes through `providerCall("epicgames:user:<accountId>", ...)`, so throttling is per account. The budget key validation only adds scope rules for `xbox`, so it needs no change.
- **Registration in the registry:** `type: EConnectionType.EPIC_GAMES = "epicgames"`, `authMode: DELEGATED_CODE`, and the importer, importer-watch and playtime flags set to true. Add `EImporterSource.EPIC_GAMES = "epicgames"` and the mapping branches in `importer.util.ts` and `playtime.util.ts`.

### D9. Epic import and playtime matching

- **Library.** Use the distinct namespaces from `getLibraryItems` as the source IDs for `matchUnprocessed(..., EpicGamesNamespace, () => 6)`. Unmapped namespaces are registered.
- **Playtime.**
  1. Build `appName → namespace` from the same library listing.
  2. Map each playtime entry's `artifactId` to its namespace and then to its game.
  3. Sum per game and upsert on platform 6 with source `EPICGAMES`, following the Xbox handler's structure.
- **Last played.** Epic exposes no last-played date. `lastPlayedDate = now` when the new total is greater than the stored one, and it stays unset on the first import. This is a `shortcut:` comment in code: last played is only accurate to the sync interval; replace it if Epic exposes per-session data.

### D10. Re-auth inbox notification through one helper

The connections screen sits under settings, so users don't see `reauth_required` until something else fails. The Epic refresh token also expires about 23 days after the last refresh. The status change therefore notifies the owner, for every provider that can reach it.

- **`markReauthRequired(manager, connection)`** in `src/connection/`. It runs a conditional `UPDATE user_connection SET authStatus = 'reauth_required' WHERE id = ? AND authStatus <> 'reauth_required'`. Only when it changes a row does it call `appendNotificationIntent` with id `connection-reauth-<connectionId>-<epochMs>`. Concurrent callers produce one notification, and a later reconnect and loss produces a new one.
- **Callers.** Epic's `requireReauth` and Xbox's three status changes call it inside `dataSource.transaction`, then throw `ProviderSyncError("reauth_required")` as before. `appendNotificationIntent` requires an active transaction.
- **Event `connection.reauth-required`.** Payload `{ connectionId, provider }`, validated with no extra keys. The projector resolves it to `subjectType: "connection"`, target `{ type: "connection", id, provider }` and `preview: { text: "Your <Provider> connection needs to be reconnected." }`. It is suppressed when the connection no longer exists. It is not grouped.
- **Client compatibility.** The shared client renderer (`packages/ui/.../AggregatedNotification.tsx` in `game-node-clients`) falls back to `preview.text` for unknown types, so a plain-text preview reads correctly before the client ships a dedicated branch. Tapping does nothing until the client routes `connection` targets to `/preferences/connections`.
- *Alternative: hook `PlayerSyncStateService.finish`.* Rejected. Epic's playtime and importer watches call the auth service outside player sync.

### D11. Notification DTO provider enums include `epicgames`

`NotificationImporterTargetDto.provider` and the import preview `provider` in `src/notifications/dto/notifications-response.dto.ts` declare the Swagger enum `["steam", "psn", "xbox"]`, but Epic import notifications already send `epicgames`. Add `epicgames` to both, and use the same enum on the new connection target DTO.

## Risks / Trade-offs

- **The unofficial Epic endpoints or the launcher client may change or be blocked.** → Failures surface as `ProviderSyncError`, so the connection degrades to sync failures, not data loss. Endpoints and client values are isolated in `src/sync/epic/` and in env.
- **Using Epic's launcher client is a terms-of-service gray area.** → Accepted by the product owner. Credentials stay configurable.
- **The Epic refresh token expires about 23 days after the last refresh, according to Legendary.** Users without a sync in that window become `reauth_required`. → Background playtime refresh runs well within that window for active connections. Inactive ones become `reauth_required`, and the owner gets a `connection.reauth-required` inbox notification (D10).
- **ID allocation by `MAX + 1` can race between `submit` and the bulk job.** → Retry on duplicate key. `(uid, category)` is not unique for GameNode rows, so a race could create a duplicate mapping. This is a `shortcut:` comment: no unique `(uid, category)` constraint for non-IGDB rows; add a generated-column unique index if duplicates show up.
- **A namespace can hold several unrelated main games**, as with some publisher sandboxes. → They are classed as ambiguous and go to moderators, never guessed.
- **The content API may 404 for products that only have a newer store page.** → Counted in `failed` and reported in the run summary. Those namespaces still reach moderators as unmapped through user imports.
- **Unreal Engine or other non-game library items may flood the unmapped queue.** → `ue` is filtered. Add more filters if the queue shows noise.

## Migration Plan

1. The migration adds `origin` with default `igdb`. It is additive and safe for the running IGDB sync. Down: drop the column after deleting rows with `origin <> 'igdb'`.
2. Deploy with `EPIC_OAUTH_CLIENT_ID` and `EPIC_OAUTH_CLIENT_SECRET` set. If they are missing, `epicgames` init fails with a 400 at runtime and other providers are unaffected.
3. An admin triggers `POST /v1/game/external/fill/epic` once after deploy. It is safe to re-run.
4. Rollback: revert the code. `bulk` and `curated` rows are harmless to the old code, which would read them as regular mappings, but the old IGDB sync would drop them on reconciliation, so delete them first or accept their loss.

## Open Questions

- Whether the Epic library has other noisy namespaces besides `ue`, such as free-weekend or private sandbox items. Answer this from real data after launch. The filter is a single list.

## Local verification (2026-11-01)

- With a temporary local Better Auth account and a real Epic authorization code, init and callback returned HTTP 201. The linked account had `authStatus: "connected"`, an account ID and display name; access and refresh tokens were stored encrypted with expiry information.
- The configured application client could exchange the code, but Epic rejected library and playtime requests with HTTP 403 and `errors.com.epicgames.common.missing_permission`. The missing permissions were `library:public:items READ` and `library:public:<accountId>:playtime:all READ`. The endpoints match D8; the configured client lacks the required library access. Successful login alone does not verify that access.
- With that application client, `GET /v1/importer/epicgames` surfaced the upstream failure as HTTP 500, and the initial background playtime refresh failed. The bulk fill was not triggered in that run.
- The generated Swagger document includes `epicgames` and the new `/v1/game/external/fill/epic` endpoint, completing task 7.2.
- A subsequent run used the launcher client published by Legendary and a fresh real authorization code. Init and callback returned HTTP 201. The D8 library and playtime endpoints both returned HTTP 200, with 41 library records (no next cursor) and 14 playtime records. No endpoint URL changes were needed.
- The background refresh finished with overall outcome `complete`, playtime `complete` and discovery `empty`. There were no category 1001 namespace mappings yet, so the importer returned HTTP 404 (`No unprocessed entries found`); matched imports and stored per-game playtime were not verified in this run.
- `POST /v1/game/external/fill/epic` returned HTTP 201 with job ID `epic-namespace-fill` and state `active`, over 10,574 source Epic mappings. The public content API also returned a namespace for the Hades sample. The full bulk run remains in progress; task 7.3 requires triggering it, which was verified. The temporary local account, credentials and its player-sync job were removed after testing.
