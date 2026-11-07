# Design

## Context

Motivation: see proposal.md, Why. Requirements: see the five spec deltas, mainly `nintendo-sync`.

What shapes the approach:

- **The Epic change built every shared piece.** This change reuses them as they are:
  - delegated-code onboarding on the existing init and callback endpoints;
  - `ConnectionCredentialService` (AES-GCM);
  - `markReauthRequired`;
  - `providerCall` and `uncancellableProviderCall` with per-account budget keys;
  - `@PlayerLibrarySnapshot`;
  - `ImporterService.matchUnprocessed`;
  - `registerUnmappedGames`;
  - GameNode-only categories in `game_external_game` with `origin`;
  - the MCP mapping tools.
- **The auth state holds no copy of `state`.** `ConnectionAuthState` stores `codeVerifier` and `metadata` but not the state value itself. `ConnectionsService.completeRedirectAuth` consumes the state before it calls the strategy, and the strategy only receives the consumed state object.
- **Platform IDs are IGDB IDs.** `GamePlatform#id` follows IGDB: Epic and Steam hard-code `6` for PC. Nintendo Switch is `130` and Switch 2 is `508`.
- **`UserPlaytimeSource.NSWITCH` already exists**, but nothing writes it today. The unique key on `user_playtime` is `(profile, game, source, platform)`.
- **The MCP mapping tools take a fixed category list:** the `mappingCategory` zod enum in `src/mcp/mcp-tools.ts`.
- **Nintendo endpoints are unofficial.** They come from community tools: ns-play-history (current v2 host), NSPlayTime and switch_tracker (older hosts), and nxapi (account endpoints and error handling).
  - **Authorize:** `GET https://accounts.nintendo.com/connect/1.0.0/authorize` with `client_id=5c38e31cd085304b` (the Nintendo Store app), `redirect_uri=npf5c38e31cd085304b://auth`, `scope=openid user user.mii user.email user.links[].id` and `response_type=session_token_code`. It also takes `session_token_code_challenge`, `session_token_code_challenge_method=S256`, `state` and `theme=login_form`. The account picker's "Select this account" button links to `npf5c38e31cd085304b://auth#session_token_code=...&state=...`.
  - **Session token:** `POST https://accounts.nintendo.com/connect/1.0.0/api/session_token` (form) with `client_id`, `session_token_code` and `session_token_code_verifier`. It returns `{ code, session_token }`.
  - **Access token:** `POST https://accounts.nintendo.com/connect/1.0.0/api/token` (JSON) with `client_id`, `session_token` and `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer-session-token`. It returns `access_token`, `id_token`, `expires_in` (900), `scope` and `token_type`.
  - **User info:** `GET https://api.accounts.nintendo.com/2.0.0/users/me` with a bearer access token. It returns `id`, `nickname` and `country`.
  - **Play history:** `GET https://app-api.znej.nintendo.com/api/v2.0/users/me/play_histories` with a bearer token and `gentry-locale`. It returns `{ playHistories[], hiddenTitleList[], recentPlayHistories[], lastUpdatedAt }`. The community-documented entry fields are:
    - `titleId` and `titleName`;
    - `platform`, which is `HAC` for Switch and `BEE` for Switch 2 (older hosts called it `deviceType`); a game played on both consoles has one entry per platform;
    - `totalPlayedMinutes` and `totalPlayedDays`;
    - `firstPlayedAt` and `lastPlayedAt` (ISO 8601);
    - `imageUrl`.
  - Local verification (below) confirmed the auth steps and the top-level shape. An entry with data has not been seen live.

## Goals / Non-Goals

**Goals:**

- Nintendo library and playtime import at the same quality as Epic: per-user credentials, `reauth_required` with an inbox notification, and per-account budgets.
- The first real sync with data must fail loudly if the documented entry shape is wrong, never import guessed data.
- No change to shared connection code other than registration.

**Non-Goals:**

- Using `recentPlayHistories`. It holds per-day data for the last week only, and totals are enough for playtime.
- Per-title detail calls (`play_histories/game_titles/<titleId>`).
- Storing `imageUrl` or Nintendo's account `country`.
- Warning users before the 730-day session expires. They get the normal re-auth notification when it does.

## Decisions

### D1. Provider module `src/sync/nintendo/`

The module mirrors `src/sync/epic/`:

- `nintendo-account.ts`: constants (client ID, redirect URI, scope, hosts, `gentry-locale: en-US` and a GameNode User-Agent) and the token request helpers. They throw the raw axios error, like `requestEpicToken`.
- `NintendoConnectionAuthProvider`: init and callback (D2, D3).
- `NintendoSyncAuthService.getAccessToken(accountId)` (D4).
- `NintendoSyncService.getPlayHistory(accountId)` (D5).
- `NintendoSyncModule`, imported by `ConnectionsModule`, `ImporterModule` and `PlaytimeWatchModule`, as Epic's module is.

Registry entry: `EConnectionType.NINTENDO = "nintendo"`, `iconName: "nintendo"` (`public/icons/nintendo.png` exists), `authMode: DELEGATED_CODE`, and importer, importer-watch and playtime set to viable.

- **Client ID as a constant, not an env variable.** Unlike Epic's launcher client, this client is public and has no secret. Changing it would mean changing the other constants too. *Alternative: env variables like Epic.* Rejected, because it would be a configuration knob nobody needs.

### D2. Init: PKCE plus state echoed into metadata

`initRedirectAuth` creates a 32-byte random verifier and its S256 challenge, then builds the authorize URL with `params.state`. It returns `{ authorizationUrl, state: params.state, codeVerifier, metadata: { state: params.state } }`.

The state goes into `metadata` because the strategy's callback receives the consumed state object, which has no copy of the state value (Context). This keeps `ConnectionsService` and `ConnectionAuthState` unchanged.

*Alternative: pass `dto.state` to `completeRedirectAuth`.* Rejected, because that would change the shared strategy interface for one provider.

### D3. Callback: parse the link, check state, exchange, identify

`completeRedirectAuth(callbackParams, savedState)`:

1. **Parse the link.** Read `callbackParams.code` as a string and trim it. It must start with `npf5c38e31cd085304b://auth#`. Parse the fragment with `URLSearchParams`. Missing `session_token_code` → 400.
2. **Check the state.** If the fragment's `state` differs from `savedState.metadata?.state` → 400, before any Nintendo call.
3. **Exchange the code.** `session_token` exchange with `savedState.codeVerifier`. Then `/api/token`, then `users/me`.
4. **Return the result.** `sourceUserId = id`, `sourceUsername = nickname || id`, and credentials:
   - `accessToken`: the access token;
   - `expiresAt`: now plus `expires_in`;
   - `refreshToken`: the session token;
   - `refreshTokenExpiresAt`: the session JWT's `exp`.

   The `exp` is read by base64url-decoding the payload, not by verifying it: we only use it as a display hint, and Nintendo decides whether the token is valid.

Any Nintendo failure → 400 with Nintendo's `error` or `errorCode`. Token values are never logged.

The single-use guard is our state, which is consumed before the strategy runs. The spike showed Nintendo accepts the same code twice, so we cannot rely on Nintendo for this.

### D4. Session lifecycle without a lock

`getAccessToken(accountId)`:

1. Load the connection by `(NINTENDO, sourceUserId)`.
2. If it is `reauth_required`, throw `ProviderSyncError("reauth_required")`.
3. Return the stored access token if it is valid for more than 5 minutes.
4. Otherwise call `/api/token` with the session token through `uncancellableProviderCall("nintendo:user:<accountId>")`, save `{ ...credentials, accessToken, expiresAt }` and return the token.

Error handling:

- **`invalid_grant`:** HTTP 400 with `error: "invalid_grant"`. Run `markReauthRequired` in a transaction, then throw `ProviderSyncError("reauth_required")`.
- **Missing session token:** treated the same way.
- **Anything else:** `providerFailure("nintendo", err)`.

**Why no lock.** The session token never rotates (verified). Two concurrent refreshes both get valid access tokens, and whichever save lands last wins harmlessly. Epic and Xbox need the lock only because their refresh invalidates the previous refresh token.

*Alternative: reuse the Epic lock pattern.* Rejected. It would add a lock for a race that loses nothing.

### D5. Play history fetch and validation

`getPlayHistory(accountId)` is decorated with `@PlayerLibrarySnapshot()`, so the importer and the playtime stage of one attempt share a single fetch.

**Request.** It calls `GET .../play_histories` through `cancellableProviderCall("nintendo:user:<accountId>")` with these headers:

- `Authorization: Bearer <access>`
- `Accept: application/json`
- `gentry-locale: en-US`. It is required, and English names keep curation consistent.
- The GameNode User-Agent.

**Validation and normalization.** This is the only place untrusted data enters:

- **Top level.** `playHistories` must be an array; otherwise → `ProviderSyncError("incomplete")`.
- **Each entry needs:**
  - `titleId` matching `/^[0-9a-f]{16}$/i`;
  - `platform ?? deviceType` as a string;
  - a finite `totalPlayedMinutes`.

  If any entry fails → `ProviderSyncError("incomplete")`, and the log lists that entry's `Object.keys` but no values. One bad entry fails the sync, because a shape change affects every entry and partial imports would hide it.
- **Normalized entry.** `{ titleId (upper-cased), titleName, platform, minutes, firstPlayedAt?, lastPlayedAt? }`. Dates that don't parse become `undefined`.
- **Hidden titles.** Drop titles listed in `hiddenTitleList`. An element may be a string or an object with `titleId`.

  `shortcut:` hidden-list elements are matched as a string or `{ titleId }`, because only an empty list has been seen; adjust once a hidden title has been observed.
- **Platform filter.** Keep only the `HAC` and `BEE` platforms. Log the other codes with their counts, without failing.

The result is the list of visible Switch entries. An empty list is a valid result.

### D6. Category, platforms and importer matching

- **Category.** Add `NintendoTitleId = 1002` to `EGameExternalGameCategory`, and `"NintendoTitleId"` to the MCP `mappingCategory` enum. `storeUrl` has no Nintendo branch: title IDs have no public store URL scheme, so `null` is correct.
- **Platforms.** Map `HAC` → `130` and `BEE` → `508`, with a `@see GamePlatform#id` comment as Epic does.
- **Importer.**
  - Fetch the play history, group the entries by `titleId`, and call `matchUnprocessed(userId, includeMarked, titleIds, NintendoTitleId, platformFor, registerUnmapped(userId, NintendoTitleId, names))`.
  - `platformFor` returns the platform of the title's entry with the latest `lastPlayedAt`.
  - `names` maps each `titleId` to its `titleName`.
- *Alternative: auto-match title names against the catalog at import time.* Rejected for now. The product owner will curate in bulk with agents through the MCP tools, so an automatic name matcher would be code nobody asked for.

### D7. Playtime import

Register `fetchPlaytime` in `PlaytimeWatchProcessor`, following `updateEpicPlaytimeInfo`:

1. **Fetch and record.** Fetch the play history and record `gamesSeen` (distinct title IDs). If there are none, return `{ outcome: "empty" }`.
2. **Look up mappings and register the rest.** Look up `NintendoTitleId` mappings and register the unmapped title IDs with their names.
3. **Combine entries.** For each visible entry whose title is mapped, group by `(gameId, platformId)`. Sum the minutes × 60, keep the earliest `firstPlayedAt` and the latest `lastPlayedAt`.
4. **Save.** Call `findForImport(userId, NSWITCH, gameIds)`. For each group, build the record from any existing row: `totalPlayCount` from the row or `0`, `recentPlaytimeSeconds: undefined`, `source: NSWITCH`, and Nintendo's real dates. Then `saveImported`.

Unlike Epic, no `lastPlayedDate = now` shortcut is needed.

### D8. Name and enum wiring

- **Importer.** `EImporterSource.NINTENDO = "nintendo"`, plus both branches in `importer.util.ts`.
- **Playtime.** `connectionToPlaytimeImportSource(NINTENDO) → NSWITCH`, plus the reverse branch in `playtimeSourceToConnectionType`.
- **Notifications.** Add `"nintendo"` to the three provider enums in `notifications-response.dto.ts`, and `nintendo: "Nintendo"` to the projector's provider name map.
- **Exhaustiveness.** `yarn build` catches the exhaustive maps. A `grep -rn "epicgames\|EPIC_GAMES" src` after the change must show a Nintendo counterpart wherever a list of providers appears.

## Risks / Trade-offs

- **[Entry shape differs from the community docs]** → D5 fails the first affected sync as `incomplete` and logs the field names. Users see a failed sync, never wrong data. Fixing it takes one constant or one field alias.
- **[Using the Nintendo Store app's client from a server is a terms-of-service gray area]** → Accepted, as for Epic. We send an honest User-Agent, read only the user's own data, and isolate all constants in `nintendo-account.ts`.
- **[Nintendo blocks or throttles datacenter IPs once there is real data]** → The spike saw no blocking and no rate-limit headers, but only with an empty history. Failures surface as `ProviderSyncError` (throttled or unavailable), and budgets are per account.
- **[The session token lasts 730 days and is an account credential for an app that can make purchases]** → It is stored encrypted like every other provider credential and never logged. The client copy tells users where to revoke access on their Nintendo Account.
- **[No bulk seed, so early imports show few matches]** → Unmapped titles reach the curation queue with English names, and admins map them through the MCP tools. Each mapping then works for every user.
- **[Copying the account-selection link is awkward on mobile]** → It is not yet verified on mobile browsers. The client hand-off asks for desktop-first instructions. If long-press copy fails, mobile users link from desktop.
- **[The play history only covers games played after the account was linked to a console]** → Documented in the client copy. Owned-but-unplayed games are out of scope (proposal).

## Migration Plan

1. Deploy. There is no migration and no configuration.
2. `nintendo` appears in `GET /v1/connections`. Clients without the hand-off still show it through the generic delegated-code paste box.
3. Rollback: revert the code. Existing `nintendo` connections become unknown providers to the old code, so delete them first (`DELETE FROM user_connection WHERE type = 'nintendo'`), or accept that their syncs fail as unsupported. `NintendoTitleId` mappings are harmless to the old code.

## Open Questions

- Which non-game titles appear in real play histories, such as system apps, video apps or Nintendo Switch Online emulators. They land in the unmapped queue and are dismissed there. Add a filter list only if they flood it.
- Whether the play history is capped or paged for very long histories. If it is, totals for old games would be missing. That affects completeness but not correctness, and can be checked on the first heavy account.

## Local verification (2026-11-01)

A spike with a real Nintendo Account (country BR) that has no play history, run from a home connection and then from `gamenode-vps`.

- **Code exchange (G1).** The `session_token` exchange returned 200 with `code` and `session_token`. The session JWT lives exactly 730 days (`exp - iat`), with `sub` = the account ID and `aud` = the client ID. Exchanging the same code again about 30 seconds later returned 200 with a fresh session token: Nintendo does not reject a replayed code, so D3 relies on our state. The code expires 10 minutes after it is issued, matching our 10-minute state TTL.
- **Token refresh (G2).** `/api/token` with the saved session token returned `expires_in: 900` and no new `session_token`, so the token doesn't rotate (D4). Refreshes 1 hour and 24 hours later were not run.
- **Play history (G3).** It returned 200 with `{"playHistories":[],"hiddenTitleList":[],"recentPlayHistories":[]}`. No entry has been seen live, so D5's validation stands in for that check.
  - Without `gentry-locale` → 400 `BAD_REQUEST` (code 400001).
  - `Bearer abc` → 401 `UNPARSEABLE_IDTOKEN` (code 401999).
  - No auth header → 400.
  - An `id_token` works as a bearer as well as the `access_token`.
  - An honest User-Agent, or none, returns 200 on `/api/token` and on play history.
- **Datacenter IP (G4).** From the VPS, token refresh, `users/me`, play history and the honest User-Agent behaved the same as at home. There was no 403, captcha, HTML error body, `Retry-After`, `X-RateLimit-*` or WAF header. The token endpoint answers with `Server: nginx`. This was not verified with non-empty history.
- **Error handling (G5).** A garbage session token → 400 `invalid_grant`, at home and on the VPS. The revoked-session and password-change cases were not run.
- **Identity (G6).** `users/me` returned `id`, `nickname` and `country`. The `id_token` has `sub` and `country` but no nickname, so D3 calls `users/me`.
- **Old hosts are dead.** `mypage-api.entry.nintendo.co.jp` doesn't resolve, and `news-api.entry.nintendo.co.jp` returned a 590 maintenance page.
