# Proposal

## Why

Gaming platform connections currently rely on unverified manual user identifiers (`userIdentifier`) and global server-owned credentials (`XBOX_API_USER`/`XBOX_API_PASS` and `PSN_NPSSO_KEY`). This allows account impersonation, exposes Xbox synchronization to global outages whenever Microsoft blocks automated password logins or enforces MFA on the server account, and scatters provider-specific `switch` logic across six modules—making it costly to add upcoming providers such as GOG, Epic Games, Ubisoft Connect, and Nintendo.

## What Changes

- **BREAKING**: Replace manual `userIdentifier` onboarding for `steam` and `xbox` with redirect-based federated authentication (`POST /v1/connections/:type/auth/init` and `POST /v1/connections/:type/auth/callback`) using frontend callback routing (`Option 1`). `POST /v1/connections` with a manual `userIdentifier` is restricted to `public_identifier` providers (`psn`).
- Add `PATCH /v1/connections/:id` (and `/v1/connections/own/:type/settings`) so users can update `isAutoImportEnabled` and `autoImportCollectionId` on existing connections without repeating the external authentication flow.
- Implement Steam OpenID 2.0 verification (`checkid_setup` generation and server-side `check_authentication` verification) to extract a verified `steamID64` and profile summary while keeping Steam Web API synchronization on `STEAM_API_KEY`.
- Implement Microsoft OAuth 2.0 (`Xboxlive.signin Xboxlive.offline_access`) to Xbox Live (XBL) and XSTS token exchange for Xbox connections, extracting `xuid`, `gamertag`, and `uhs` directly from XSTS display claims and eliminating `getXboxPlayerXUID` gamertag scraping during onboarding.
- Add `UserConnectionCredential` (`user_connection_credential`) with AES-256-GCM encryption at rest for per-connection OAuth access/refresh tokens and cached XSTS session metadata, strictly isolated from public `UserConnection` DTO serialization, plus an `authStatus` (`connected` | `reauth_required`) field on `UserConnection`.
- Refactor `XboxSyncAuthService` and `XboxSyncService` to execute player-scoped requests (`getAllGames`, `getBatchMinutesPlayed`, `getObtainedAchievements`) using the connection's own XSTS credentials with automatic refresh-token rotation, while isolating global catalog lookups (`getAvailableAchievements`) onto a cached system/fallback credential.
- Integrate `reauth_required` handling into `PlayerSyncStateService` and `ProviderSyncError` so revoked or permanently invalid user OAuth grants transition the connection to `reauth_required` and halt recurring background refreshes until the user reconnects.
- Retain the existing PSN `public_identifier` lookup and global `PSN_NPSSO_KEY` flow without workarounds.
- Introduce a unified `ConnectionProviderRegistry` that declares each provider's `authMode` (`redirect`, `public_identifier`, or `delegated_code`) and sync capabilities, replacing scattered provider switches and preparing the architecture for GOG, Epic Games, Ubisoft Connect, and Nintendo.
- Assume a clean database baseline with no legacy user migration required.

## Capabilities

### New Capabilities

- `connection-auth`: Multi-mode connection onboarding (`redirect`, `public_identifier`, `delegated_code`), Redis-backed anti-CSRF state management, Steam OpenID 2.0 verification, decoupled connection settings updates, and encrypted per-connection credential persistence.
- `xbox-user-token-sync`: Microsoft OAuth 2.0 to XBL/XSTS token lifecycle per connection, silent refresh-token rotation, revoked-grant (`reauth_required`) sync suppression, and separation between user-scoped and catalog-scoped Xbox API calls.
- `connection-provider-registry`: Declarative provider capability metadata (`authMode`, importer, playtime, achievements, budget policy) and unified provider dispatch across connection management and synchronization pipelines.

### Modified Capabilities

None. The project's main `openspec/specs/` inventory is currently empty.

## Impact

- **Connection API & Persistence**: `src/connection/` (`ConnectionsController`, `ConnectionsService`, `UserConnection`, new `UserConnectionCredential` entity, DTOs, and database migration).
- **Provider Auth & Sync**: `src/sync/steam/`, `src/sync/xbox/` (`XboxSyncAuthService`, `XboxSyncService`), `src/sync/psn/`, `src/sync/player-data/` (`PlayerSyncStateService`, `PlayerDataProcessor`), `src/sync/provider-sync.error.ts`, and `src/sync/player-provider-budget.service.ts`.
- **Downstream Consumers**: `src/playtime/watch/playtime-watch.processor.ts`, `src/importer/importer.service.ts`, and `src/game/game-achievement/` (`GameAchievementService`, `GameObtainedAchievementService`).
- **Configuration**: New environment variables for Xbox OAuth (`XBOX_OAUTH_CLIENT_ID`, `XBOX_OAUTH_CLIENT_SECRET`, `XBOX_OAUTH_REDIRECT_URI`), Steam OpenID realm/return URL configuration (derived from `DOMAIN_WEBSITE` or explicit env), and credential encryption key (`CONNECTION_CREDENTIAL_ENCRYPTION_KEY`).
- **Authentication Boundary**: `src/auth/` (SuperTokens) remains completely untouched and decoupled from gaming platform connections.
