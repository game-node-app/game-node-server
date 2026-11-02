# Tasks

## 1. Provider registration and enums

- [x] 1.1 Add `EConnectionType.NINTENDO = "nintendo"` and include it in the importer, importer-watch and playtime lists in `connections.constants.ts`. Register it in `ConnectionProviderRegistry` with `iconName: "nintendo"` and `authMode: DELEGATED_CODE`. Verify that `connection-provider.registry.spec.ts` asserts the `nintendo` metadata and capability flags from the registry spec delta.
- [x] 1.2 Add `NintendoTitleId = 1002` to `EGameExternalGameCategory` and `"NintendoTitleId"` to the `mappingCategory` enum in `src/mcp/mcp-tools.ts`. Verify that `mcp-tools.service.spec.ts` (or the MCP tool registration spec) accepts `NintendoTitleId` in `list_unmapped_games`.
- [x] 1.3 Add `EImporterSource.NINTENDO = "nintendo"` and both branches in `importer.util.ts`. In `playtime.util.ts`, map `NINTENDO` to `UserPlaytimeSource.NSWITCH` in both directions. Add `"nintendo"` to the three provider enums in `notifications-response.dto.ts`, and `nintendo: "Nintendo"` to the provider name map in `notifications-projector.service.ts`. Verify that `yarn build` passes, that the projector spec has a Nintendo `connection.reauth-required` case whose preview names "Nintendo", and that `grep -rn "epicgames\|EPIC_GAMES" src` shows a Nintendo counterpart wherever a list of providers appears (design D8).

## 2. Nintendo account auth

- [x] 2.1 Create `src/sync/nintendo/nintendo-account.ts` with the constants (client ID, redirect URI, scope, hosts, `gentry-locale` and the GameNode User-Agent) and three helpers that throw the raw axios error: `requestSessionToken(code, verifier)`, `requestAccessToken(sessionToken)` and `getNintendoUser(accessToken)`. Verify with a spec using mocked axios that each helper sends the body, content type and headers listed in design Context.
- [x] 2.2 Add `NintendoConnectionAuthProvider` (design D2, D3).
  - Init returns the authorize URL with an S256 challenge, plus `state`, `codeVerifier` and `metadata.state`.
  - Callback parses the pasted `npf...://auth#` link, checks the fragment `state` against `savedState.metadata.state` before any call, then exchanges and identifies.
  - It returns `sourceUserId = id`, `sourceUsername = nickname` and the credentials, with `refreshTokenExpiresAt` taken from the session JWT's `exp`.

  Register it in `ConnectionsModule` via a new `NintendoSyncModule`. Verify with `nintendo-connection-auth.provider.spec.ts`:
  - the init URL carries the challenge and the state;
  - a valid link links the account;
  - a non-link input, a missing `session_token_code` and a state mismatch all give 400 with no axios call;
  - a Nintendo rejection gives 400 and no credentials;
  - no token value appears in the logged errors.
- [x] 2.3 Add `NintendoSyncAuthService.getAccessToken(accountId)` (design D4).
  - It reuses an access token that is valid for more than 5 minutes; otherwise it calls `/api/token` through `uncancellableProviderCall("nintendo:user:<accountId>")` and saves the new access token while keeping the session token.
  - `invalid_grant` or a missing session token → `markReauthRequired` in a transaction, then `ProviderSyncError("reauth_required")`.
  - Other errors go through `providerFailure("nintendo")`.

  Verify with `nintendo-sync-auth.service.spec.ts`:
  - a fresh token is reused without a call;
  - an expiring token is refreshed and the session token is unchanged;
  - `invalid_grant` sets `reauth_required` and creates one notification intent;
  - a 5xx stays `connected` and throws a non-reauth outcome.

## 3. Play history

- [x] 3.1 Add `NintendoSyncService.getPlayHistory(accountId)` with `@PlayerLibrarySnapshot()` and `cancellableProviderCall("nintendo:user:<accountId>")`, plus the validation and normalization from design D5 and its `shortcut:` comment for the hidden-list shape. Verify with `nintendo-sync.service.spec.ts`:
  - a documented v2 entry is normalized, and its `titleId` is upper-cased;
  - an entry using `deviceType` instead of `platform` is accepted;
  - an entry without a valid `titleId` fails as `incomplete`, and the log holds only field names;
  - a missing `playHistories` fails as `incomplete`;
  - an empty array returns `[]`;
  - a title in `hiddenTitleList` (string form and `{ titleId }` form) is dropped;
  - a non-`HAC`/`BEE` entry is dropped without failing;
  - the request sends `gentry-locale: en-US` and the per-account budget key.

## 4. Library import

- [x] 4.1 Register Nintendo `fetchLibraryGames` in `ImporterService` through `matchUnprocessed`, with title IDs, `NintendoTitleId`, a `platformFor` that picks the latest-played entry's platform (`HAC` → 130, `BEE` → 508), and `registerUnmapped` with the title names (design D6). Add `NintendoSyncModule` to `ImporterModule`. Verify with `importer.service.spec.ts`:
  - a title on both consoles, played last on `BEE`, yields one item on platform 508;
  - an `HAC`-only title yields platform 130;
  - an unmapped title is registered with its name;
  - an already processed title is not listed unless processed entries are included.
- [x] 4.2 Confirm that `game_platform` has rows with IDs 130 and 508 in a database synced from IGDB (`SELECT id, abbreviation FROM game_platform WHERE id IN (130, 508)`). If 508 is missing, stop and raise it, because Switch 2 imports would reference a missing platform.

## 5. Playtime import

- [x] 5.1 Register Nintendo `fetchPlaytime` in `PlaytimeWatchProcessor` (design D7):
  - record `gamesSeen`, and return `empty` when there are no entries;
  - register unmapped titles;
  - group by `(gameId, platformId)`: sum minutes × 60, keep the earliest first-played and latest last-played dates;
  - save with source `NSWITCH`.

  Add `NintendoSyncModule` to `PlaytimeWatchModule`. Verify with `playtime-watch.processor.spec.ts` using the `nintendo-sync` spec's own scenarios:
  - 250 minutes on `HAC` → 15,000 seconds on platform 130 with both dates;
  - one title with 100 minutes on `HAC` and 40 minutes on `BEE` → two records of 6,000 and 2,400 seconds;
  - unmapped and hidden titles store nothing;
  - an empty history returns `empty`.

## 6. Integration checks

- [x] 6.1 Run `yarn build`, `yarn lint` and `yarn test` for `src/connection`, `src/importer`, `src/playtime`, `src/sync`, `src/mcp`, `src/notifications` and `src/game/external-game`. Verify that they all pass.
- [x] 6.2 Start the app so that `server_swagger.json` is regenerated. Confirm the diff shows `nintendo` in the connection type and provider enums, and nothing unrelated.
- [ ] 6.3 Do a manual end-to-end run with the spike's Nintendo Account in a local environment: init, open the URL, paste the "Select this account" link, callback, `GET /v1/importer/nintendo`, and a playtime refresh. Expected result: connected, 404 "No unprocessed entries found", and playtime outcome `empty`. Record the results under "Local verification" in design.md. Afterwards, remove the local connection and revoke the session on the Nintendo Account.

## 7. Client hand-off

- [x] 7.1 Generate `openspec/changes/add-nintendo-connection/handoff-clients.md` for `game-node-clients`. It must be self-contained and list:
  - **Connection name:** a `UserConnectionDto.type.NINTENDO` → "Nintendo" branch in `packages/ui/src/components/connections/util/getConnectionName.ts`, plus a profile URL decision in `getConnectionProfileURL.ts` (Nintendo has no public profile, so none).
  - **Importer source:** `"nintendo"` in `VALID_SOURCES` in `packages/ui/src/components/importer/view/ImporterScreen.tsx`.
  - **Paste-step copy:** the `delegatedCode` copy in `packages/locales/src/translations/json/en.json` and `pt-BR.json` is Epic-specific ("shows a page like this ... copy the code"). For Nintendo, it must say "right-click or long-press 'Select this account' and copy the link; don't click it". Use a provider-specific key or a `{{type}}` branch in `PreferencesConnectionDelegatedCode.tsx`, which already sends `callbackParams.code` trimmed.
  - **Coverage and privacy notes:** only games played on Switch or Switch 2 after the account was linked to a console are imported, and where to revoke access on the Nintendo Account.
  - **Import notifications:** a "Nintendo" display name in import notifications.
  - **Mobile test:** a case next to `apps/mobile/src/components/preferences/connections/connection-auth.test.tsx`.
  - **API wrapper:** regenerate it from the updated `server_swagger.json`.

  Verify that every file path it names exists in `game-node-clients`.

## Workflow follow-up

- Hand the client work in `game-node-clients` over through the hand-off from task 7.1.
- After the first real user with play history connects, check the logs for D5 `incomplete` failures and for the dropped platform codes, then update design.md's verification notes.
- Archive the change after review.
