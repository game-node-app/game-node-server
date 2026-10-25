# Tasks

## 1. Credential Persistence, Encryption, and Auth State Foundation

- [x] 1.1 Add `EConnectionAuthMode` (`redirect`, `public_identifier`, `delegated_code`) and `EConnectionAuthStatus` (`connected`, `reauth_required`) to `src/connection/connections.constants.ts`, extend `UserConnection` with `authStatus`, create `UserConnectionCredential` (`src/connection/entity/user-connection-credential.entity.ts`), and generate the TypeORM migration; verify entity metadata and migration compilation with `yarn build`.
- [x] 1.2 Implement `ConnectionCredentialCryptoService` using Node `aes-256-gcm` with startup validation for `CONNECTION_CREDENTIAL_ENCRYPTION_KEY` and `ConnectionCredentialService` for encrypted read/write/delete operations; verify round-trip encryption, tamper rejection, and invalid-key startup failure with unit tests (`connection-credential-crypto.service.spec.ts`).
- [x] 1.3 Implement Redis-backed `ConnectionAuthStateService` (`initState` with 10-minute TTL and atomic single-use `consumeState` verifying `userId` and `type`); verify TTL assignment, replay rejection, and session-mismatch errors (`403`) with unit tests (`connection-auth-state.service.spec.ts`).
- [x] 1.4 Extend `UserConnectionDto` with `authStatus` and `FindAvailableConnectionsResponseDto` with `authMode`; verify `toDto` in `ConnectionsService` never serializes `UserConnectionCredential` fields via unit tests in `connections.service.spec.ts`.

## 2. Declarative Provider Registry and Onboarding Endpoints

- [x] 2.1 Implement `ConnectionProviderRegistry` (`src/connection/connection-provider.registry.ts`) defining provider metadata, `authMode`, capability flags, auth strategy hooks, and sync handlers for `steam`, `psn`, and `xbox`; verify capability discovery and unknown-provider rejection with unit tests (`connection-provider.registry.spec.ts`).
- [x] 2.2 Add `POST /v1/connections/:type/auth/init`, `POST /v1/connections/:type/auth/callback`, and `PATCH /v1/connections/:id` (plus DTOs for redirect init, callback payload, and settings update) to `ConnectionsController` and `ConnectionsService`, and restrict `POST /v1/connections` to `public_identifier` providers (`psn`); verify controller/service behavior and HTTP 400/403/404 guards in `connections.controller.spec.ts` and `connections.service.spec.ts`.
- [x] 2.3 Verify `PATCH /v1/connections/:id` updates `isAutoImportEnabled` and `autoImportCollectionId` (with collection ownership checks) while preserving `UserConnectionCredential` and `PlayerConnectionSync` eligibility in `connections.service.spec.ts`.

## 3. Steam OpenID 2.0 Authentication

- [x] 3.1 Implement `SteamConnectionAuthProvider` (`initRedirectAuth` building the `https://steamcommunity.com/openid/login` URL with frontend callback return path, and `completeRedirectAuth` posting `check_authentication` to Steam, validating canonical `claimed_id`/`identity` `steamid64`, and fetching `getUserSummary`); verify valid callbacks, forged signatures, and malformed `claimed_id` rejection with unit tests (`steam-connection-auth.provider.spec.ts`).
- [x] 3.2 Wire `SteamConnectionAuthProvider` into `ConnectionProviderRegistry` and remove manual `steam` identifier resolution from `POST /v1/connections`; verify end-to-end Steam onboarding and initial sync registration in `connections.service.spec.ts`.

## 4. Xbox OAuth 2.0, Per-User XSTS Lifecycle, and Revoked-Grant Handling

- [x] 4.1 Implement `XboxConnectionAuthProvider` (`initRedirectAuth` targeting Microsoft OAuth 2.0 with `Xboxlive.signin Xboxlive.offline_access` and `completeRedirectAuth` exchanging `code` -> MS OAuth tokens -> XBL token -> XSTS token and extracting `xuid`, `gamertag`, and `uhs` from XSTS claims); verify successful exchange and `XErr` profile/consent error mapping with unit tests (`xbox-connection-auth.provider.spec.ts`).
- [x] 4.2 Refactor `XboxSyncAuthService` to provide `getUserAuthCredentials(playerXUID)` backed by `UserConnectionCredential` with cached XSTS reuse, Redis-locked Microsoft `refresh_token` rotation, and `getCatalogAuthCredentials()` for catalog-level achievement schema lookups; verify cached reuse, token rotation, concurrent refresh locking, and catalog fallback in `xbox-sync-auth.service.spec.ts`.
- [x] 4.3 Update `XboxSyncService` so player-scoped methods (`getAllGames`, `getBatchMinutesPlayed`, `getObtainedAchievements`) call `getUserAuthCredentials(playerXUID)` while `getAvailableAchievements(titleId)` calls `getCatalogAuthCredentials()`, keeping `@Cacheable` method signatures unchanged; verify in `xbox-sync.service.spec.ts`.
- [x] 4.4 Add `\"reauth_required\"` to `ProviderFailureOutcome` (`src/sync/provider-sync.error.ts`), transition `UserConnection.authStatus` to `reauth_required` when Xbox token refresh fails with `invalid_grant`, and update `PlayerSyncStateService.due()` to skip `reauth_required` connections until re-authenticated; verify in `provider-sync.error.spec.ts` and `player-sync-state.service.spec.ts`.

## 5. Registry-Driven Sync Dispatch and Budget Scoping

- [x] 5.1 Refactor `PlayerDataProcessor`, `PlaytimeWatchProcessor`, `ImporterService`, and `GameObtainedAchievementService` to dispatch provider sync operations through `ConnectionProviderRegistry`; verify existing unit suites (`player-data.processor.spec.ts`, `importer.service.spec.ts`, `game-obtained-achievement.service.spec.ts`) pass.
- [x] 5.2 Update `PlayerProviderBudgetService` to validate registered providers via `ConnectionProviderRegistry` and scope player-token Xbox requests per connection/user while keeping global budgets for shared-key calls (`Steam`, `PSN`, `Xbox:catalog`); verify independent per-user Xbox cooldown behavior in `player-provider-budget.service.spec.ts`.
- [x] 5.3 Document the new environment variables (`CONNECTION_CREDENTIAL_ENCRYPTION_KEY`, `XBOX_OAUTH_CLIENT_ID`, `XBOX_OAUTH_CLIENT_SECRET`, `XBOX_OAUTH_REDIRECT_URI`) and the frontend redirect callback contract, and run full `yarn test` and `yarn build` to confirm zero regressions.

## 6. Review fixes

- [x] 6.1 Add the missing auth-status and credential-table migration, including cascade deletion and rollback; verify schema metadata and migration behavior.
- [x] 6.2 Consume redirect state atomically in Redis; test concurrent consumption, TTL, replay, and session/provider mismatch.
- [x] 6.3 Bind Steam's signed return URL to the initiated callback and state; reject mismatched origins, paths, states, and noncanonical identities.
- [x] 6.4 Replace the Xbox refresh lock with atomic Redis acquisition, ownership-safe renewal/release, and bounded waiting; test independent service instances and lock loss.
- [x] 6.5 Fix collection settings persistence with loaded relations; verify changing and clearing a collection while preserving credentials and sync cooldowns.
- [x] 6.6 Finalize reauth-required sync failures immediately and stop BullMQ retries for full and achievement refreshes; verify terminal outcomes and lease release.
- [x] 6.7 Reset sync eligibility on successful redirect reauthentication, including existing cooldowns, leases, and reauth-required outcomes; preserve settings-only cooldowns.
- [x] 6.8 Bound cached Xbox catalog credentials by actual XSTS expiration; verify near-expiry tokens are refreshed instead of reused indefinitely.
- [x] 6.9 Register and invoke provider handlers for onboarding, library discovery, playtime, and obtained achievements; remove hard-coded orchestration fallbacks and verify unsupported-capability errors and module wiring.
- [x] 6.10 Correct callback request examples and environment/capability documentation, add the proposed own/type settings route, and run regression tests, the full unit suite, build, and OpenSpec validation.

## Verification after review fixes

- `yarn build` and `openspec validate federate-connection-auth --strict` pass.
- Disposable MySQL/Redis checks: 8 suites and 91 tests pass, including migration rollback/cascade, collection settings, concurrent state consumption, lock ownership, reconnect eligibility, and BullMQ terminal failures.
- Full `yarn test --runInBand`: 78 suites pass, 8 fail, and 6 are skipped; 546 tests pass, 9 fail, and 77 are skipped. Failures are in unchanged auth, achievements, user-init, follow, profile, and suspension tests (stale method expectations, unresolved import paths, and missing dependency mocks). These files and their implementations have no diff from HEAD.
- Live Steam/Microsoft exchanges and web/mobile client updates remain outside this verification.

## Workflow follow-up

- Coordinate with web and mobile client updates to consume `authMode` from `GET /v1/connections`, route `steam` and `xbox` through `/v1/connections/:type/auth/init` and `/v1/connections/:type/auth/callback`, and use `PATCH /v1/connections/:id` for auto-import settings updates.
- Archive this change with `$openspec-archive-change` after implementation and verification are complete.
