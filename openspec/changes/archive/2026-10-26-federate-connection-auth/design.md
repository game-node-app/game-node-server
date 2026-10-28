# Design

## Context

See `proposal.md` for motivation and the three capability specs (`connection-auth`, `xbox-user-token-sync`, `connection-provider-registry`) for acceptance requirements.

Key observations from the current codebase:

- `ConnectionsService.createOrUpdate` currently accepts `{ type, userIdentifier, isAutoImportEnabled, autoImportCollectionId }` for all providers and dispatches via a `switch (type)` statement to `steamSyncService.resolveUserInfo`, `psnSyncService.resolveUserInfo`, or `xboxSyncService.resolveUserInfo`.
- `AuthService` (`src/auth/auth.service.ts`) configures SuperTokens `ThirdParty` and `Passwordless` recipes for primary GameNode account login with email-based account linking. Gaming platform connections in `src/connection/` are profile-linked external accounts (`UserConnection` tied to `Profile`), not SuperTokens login identities.
- `UserConnection` rows are returned on `@Public()` endpoints (`GET /v1/connections/user/:userId`) via `toDto(userConnection)`, which spreads all `UserConnection` entity properties except `profile`. Storing secrets on `UserConnection` would risk leaking them in public responses.
- `XboxSyncAuthService` currently logs in with a single global account (`XBOX_API_USER` / `XBOX_API_PASS`) via `@xboxreplay/xboxlive-auth` and caches `{ xsts_token, user_hash }` under a single Redis key (`xbox-sync-auth-cred`).
- `SteamSyncService`, `PsnSyncService`, and `XboxSyncService` decorate player and catalog methods with `@Cacheable`, which derives Redis cache keys by serializing method arguments (`jsum.digest(args)`). Passing mutable credential objects or tokens as arguments to `@Cacheable` methods would fragment cache keys on every token refresh.
- `PlayerSyncStateService` (`src/sync/player-data/player-sync-state.service.ts`) coordinates daily full refreshes (`PlayerConnectionSync`) and per-game achievement refreshes (`PlayerGameSync`) with optimistic/pessimistic lease ownership (`ownerToken`, `leaseExpiresAt`). `ProviderSyncError` classifies outcomes into `"unsupported" | "unavailable" | "throttled" | "incomplete" | "failed"`.
- No legacy user migration is required (clean baseline assumed).

## Goals / Non-Goals

**Goals:**
- Provide a unified, extensible authentication and synchronization contract supporting `redirect` (OAuth 2.0 / OpenID 2.0), `public_identifier` (PSN), and future `delegated_code` (GOG, Epic Games, Nintendo) flows.
- Isolate encrypted per-connection credentials from public `UserConnection` entities and `@Cacheable` method signatures.
- Eliminate global Xbox user/password scraping for player synchronization while preserving public Xbox achievement schema lookups.
- Prevent revoked OAuth grants from causing infinite hourly retry loops in `PlayerDataQueueService`.

**Non-Goals:**
- Coupling gaming connections to SuperTokens login recipes.
- Implementing GOG, Epic Games, Ubisoft Connect, or Nintendo sync clients in this change (only the extensible provider contracts and registry are introduced here).
- Modifying PSN's `psn-api` transport or adding bio-verification workarounds for PSN.
- Migrating legacy unauthenticated Steam/Xbox rows.

## Decisions

### 1. Keep gaming connections in `ConnectionsModule`, decoupled from SuperTokens

SuperTokens `ThirdParty` requires verified email addresses or synthetic email generation and is designed around session creation (`Session.createNewSession`), whereas Steam OpenID 2.0 provides no email address and Xbox connections require long-lived background `refresh_token` access inside BullMQ workers without an active HTTP session. Implementing the redirect state and token exchange directly inside `ConnectionsModule` keeps session authentication (`AuthGuard`) and external gaming data sources cleanly separated.

*Alternative considered:* Register Steam and Xbox as SuperTokens `ThirdParty` providers. Rejected because Steam OpenID 2.0 is not OAuth 2.0/OIDC and background workers would still need custom token refresh management outside SuperTokens sessions.

### 2. Frontend-routed callback (`Option 1`) with Redis-backed single-use `state`

1. Client calls `POST /v1/connections/:type/auth/init` (authenticated via `AuthGuard`) with `{ isAutoImportEnabled?: boolean, autoImportCollectionId?: string | null }`.
2. `ConnectionAuthStateService` validates collection ownership up front, generates a 32-byte hex `state` token (and PKCE `codeVerifier` when supported by the provider), stores `{ userId, type, isAutoImportEnabled, autoImportCollectionId, codeVerifier }` in Redis (`conn-auth-state:${state}`, TTL 600s), and returns `{ authorizationUrl, state }`.
3. The browser/mobile webview redirects to `authorizationUrl`, which returns the user to the frontend callback route (`${DOMAIN_WEBSITE}/connections/callback/:type?...`).
4. The frontend sends the received query parameters to `POST /v1/connections/:type/auth/callback` with `{ state, callbackParams }`.
5. The server atomically fetches and deletes `conn-auth-state:${state}`, verifies `stored.userId === session.getUserId()` and `stored.type === type`, delegates verification/token exchange to the provider strategy, persists `UserConnection` + `UserConnectionCredential`, and triggers initial sync.

*Alternative considered:* Direct backend GET callback with `302 Redirect` to the frontend. Rejected because Web and Mobile clients already manage authenticated API calls via SuperTokens and handle loading/error states more cleanly when invoking `POST /v1/connections/:type/auth/callback`.

### 3. Dedicated `UserConnectionCredential` entity with AES-256-GCM encryption

Add `UserConnectionCredential` (`user_connection_credential`) with `connectionId` as primary key and `OneToOne` (`onDelete: "CASCADE"`) to `UserConnection`:
- `accessTokenEncrypted: string`
- `refreshTokenEncrypted: string | null`
- `expiresAt: Date | null`
- `refreshTokenExpiresAt: Date | null`
- `providerMetadataEncrypted: string | null` (JSON storing `{ xstsToken, userHash, xstsExpiresAt }` for Xbox)
- `updatedAt: Date`

Add `authStatus: EConnectionAuthStatus` (`"connected"` | `"reauth_required"`, default `"connected"`) to `UserConnection` and expose it on `UserConnectionDto`. Encrypt sensitive columns using Node's built-in `node:crypto` (`aes-256-gcm` with random 12-byte IV and 16-byte auth tag prefixed to ciphertext, keyed by `CONNECTION_CREDENTIAL_ENCRYPTION_KEY`).

*Alternative considered:* Nullable token columns on `UserConnection` with `@Exclude()`. Rejected because `ConnectionsService` uses object spread (`{ ...userConnection }`) in `toDto`, making accidental token exposure too easy.

### 4. Resolve Xbox credentials by `sourceUserId` / `connectionId` inside `XboxSyncAuthService` to preserve `@Cacheable`

`@Cacheable` in `src/utils/cacheable.ts` hashes all method parameters (`jsum.digest(args)`) to build the Redis cache key. If `XboxSyncService.getAllGames(playerXUID, credentials)` accepted a credential object, every XSTS token rotation would invalidate the 1-hour cache.

Instead:
- `XboxSyncService.getAllGames(playerXUID)`, `getBatchMinutesPlayed(playerXUID, titleIds)`, and `getObtainedAchievements(playerXUID, titleId)` keep their exact parameter signatures (`playerXUID: string`).
- Inside those methods, `this.authService.getUserAuthCredentials(playerXUID)` looks up the active `UserConnectionCredential` for `{ type: EConnectionType.XBOX, sourceUserId: playerXUID }`, returns the cached XSTS token if still valid (with a 5-minute safety buffer), or refreshes the Microsoft OAuth token (`https://login.live.com/oauth20_token.srf`) -> XBL user token (`https://user.auth.xboxlive.com/user/authenticate`) -> XSTS token (`https://xsts.auth.xboxlive.com/xsts/authorize`) under a Redis mutex lock per `connectionId`.
- For catalog-level `getAvailableAchievements(titleId)`, `XboxSyncService` calls `this.authService.getCatalogAuthCredentials()`, which uses the cached system credential (or any valid cached catalog token) so unauthenticated game page views continue to work.

*Alternative considered:* Pass `UserConnectionCredential` through all service methods and write a custom `@Cacheable` key generator. Rejected because keeping `playerXUID` as the method argument is simpler and avoids touching unrelated cache infrastructure.

### 5. First-class `reauth_required` outcome in `ProviderSyncError` and `PlayerSyncStateService`

Extend `ProviderFailureOutcome` in `src/sync/provider-sync.error.ts` with `"reauth_required"`.
- When `XboxSyncAuthService` receives `invalid_grant` (or a permanent 400/401 from the OAuth refresh endpoint), it updates `UserConnection.authStatus = EConnectionAuthStatus.REAUTH_REQUIRED` and throws `new ProviderSyncError("reauth_required", "Xbox connection requires re-authentication")`.
- In `PlayerSyncStateService.due()`, exclude connections whose `UserConnection.authStatus = "reauth_required"` so `PlayerDataQueueService.registerDueJobs()` does not repeatedly schedule dead connections.
- When the user re-authenticates via `POST /v1/connections/xbox/auth/callback`, `ConnectionsService` resets `authStatus = "connected"` and calls `syncState.initialize(...)`, immediately re-enabling synchronization.

### 6. Declarative `ConnectionProviderRegistry` and budget scoping

Introduce `ConnectionProviderRegistry` in `src/connection/` where each provider registers a `ConnectionProviderDefinition`:
- Metadata & capabilities (`type`, `name`, `iconName`, `authMode`, `isImporterViable`, `isImporterWatchViable`, `isPlaytimeImportViable`, `isAchievementImportViable`).
- Auth strategy (`initRedirectAuth?`, `completeRedirectAuth?`, `resolvePublicIdentifier?`, `exchangeDelegatedCode?`).
- Sync handlers for playtime, importer unprocessed candidates, and obtained achievements.
- Budget key resolution in `PlayerProviderBudgetService`: global key (`{Steam}`, `{PSN}`, `{Xbox:catalog}`) vs. per-user key (`{Xbox:user:<sourceUserId>}`) so one Xbox user's rate limit does not block other Xbox users.

## Risks / Trade-offs

- [Steam OpenID does not grant private-profile API access] → Document clearly in API/UI that Steam OpenID verifies account ownership and resolves `steamID64` automatically, while the user's Steam game details must still be public for `STEAM_API_KEY` synchronization.
- [Catalog-level Xbox achievement lookup requires a valid XSTS token even when no user is in context] → `XboxSyncAuthService.getCatalogAuthCredentials()` sources a token from the optional system account (`XBOX_API_USER`/`XBOX_API_PASS`) or a connected user's credentials. Credential caching ends before the token's actual expiration; the achievement schema itself remains cached for 24 hours.
- [Concurrent jobs for the same Xbox user could race on OAuth `refresh_token` rotation] → Protect refresh with an atomic Redis lock (`xbox-token-refresh-lock:${connectionId}`), a unique ownership token, renewal while the exchange runs, and owner-checked release. Re-read credentials after acquiring the lock and do not persist a result after losing ownership.
- [Encryption key rotation or misconfiguration] → Validate at startup (`OnModuleInit` / config validation) that `CONNECTION_CREDENTIAL_ENCRYPTION_KEY` is a valid 32-byte key (64 hex chars or 44 base64 chars) so misconfiguration fails fast before accepting user callbacks.

## Review corrections

- Use the existing BullMQ Redis connection for atomic auth-state consumption and refresh locking, avoiding cache-manager read/write sequences for coordination.
- Save Steam's expected frontend return URL (including the state) in pending auth metadata and require the signed callback URL to match it before accepting the assertion.
- Treat `reauth_required` as terminal in both worker pipelines, finalize the attempt immediately, and reset full and per-game sync state on successful redirect reauthentication. Settings updates preserve cooldowns.
- Register actual provider handlers for public identifier onboarding, library discovery, playtime, and obtained achievements; consumers dispatch through those handlers rather than adding provider branches.

## Migration Plan

1. Run the TypeORM migration adding `authStatus` to `user_connection` and creating `user_connection_credential`.
2. Configure `CONNECTION_CREDENTIAL_ENCRYPTION_KEY`, `XBOX_OAUTH_CLIENT_ID`, `XBOX_OAUTH_CLIENT_SECRET`, and `XBOX_OAUTH_REDIRECT_URI` in environment configuration.
3. Deploy the server and updated web/mobile clients using the new `/v1/connections/:type/auth/init`, `/v1/connections/:type/auth/callback`, and `PATCH /v1/connections/:id` endpoints.
4. Rollback: revert the deployment and revert the additive migration if needed (no existing production user connections need data migration).
