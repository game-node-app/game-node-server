# Spec Delta

## Purpose

Manages the Microsoft OAuth 2.0 to Xbox Live (XBL) and XSTS per-user credential lifecycle, silent token refresh during background synchronization, revoked-grant handling, and catalog-scoped credential separation.

## ADDED Requirements

### Requirement: Microsoft OAuth 2.0 to XBL/XSTS onboarding exchange
The system SHALL exchange the authorization code returned to `POST /v1/connections/xbox/auth/callback` for Microsoft OAuth `access_token` and `refresh_token` (`Xboxlive.signin Xboxlive.offline_access`), authenticate against Xbox Live (`user.auth.xboxlive.com`), authorize an XSTS token (`xsts.auth.xboxlive.com` for relying party `http://xboxlive.com`), and extract the user's authoritative `xuid` (`xid`), `gamertag` (`gtg`), and `userHash` (`uhs`) directly from the XSTS display claims.

#### Scenario: Successful Xbox OAuth callback
- **WHEN** a user completes Microsoft OAuth login and submits a valid authorization code and `state` to `POST /v1/connections/xbox/auth/callback`
- **THEN** the server exchanges the code for OAuth tokens and XSTS claims, persists the `UserConnection` using the claimed `xuid` and `gamertag` with `authStatus: "connected"`, stores the encrypted OAuth and XSTS credentials in `user_connection_credential`, and schedules initial synchronization

#### Scenario: Microsoft account without an Xbox Live profile
- **WHEN** the XSTS exchange fails because the Microsoft account has no Xbox profile or requires adult/child consent (`XErr` response)
- **THEN** the server rejects the callback with a descriptive HTTP 400 error and does not persist a partial connection

### Requirement: Per-user Xbox synchronization and silent token rotation
Player-scoped Xbox operations (`getAllGames`, `getBatchMinutesPlayed`, `getObtainedAchievements`) SHALL authenticate using the XSTS token and `userHash` belonging to the target connection. When the cached XSTS token is expired or near expiration, the system SHALL refresh the user's Microsoft OAuth token and re-issue the XSTS token under a per-connection lock, persisting the rotated tokens in `user_connection_credential`.

#### Scenario: Valid cached XSTS token during sync
- **WHEN** a player sync job requests Xbox library, playtime, or obtained achievements for a connection whose cached XSTS token has not expired
- **THEN** the request uses the connection's cached `XSTSToken` and `userHash` without calling Microsoft OAuth or XBL token endpoints

#### Scenario: Expired XSTS token with valid refresh token
- **WHEN** a player sync job runs for a connection whose XSTS token is expired but whose OAuth `refresh_token` is valid
- **THEN** the system refreshes the OAuth token, obtains a new XSTS token, updates the encrypted credential record, and completes the Xbox API call

### Requirement: Revoked grant detection and re-authentication state
When refreshing a connection's Microsoft OAuth token or exchanging it for XBL/XSTS fails due to a revoked, expired, or invalid grant (`invalid_grant` or permanent HTTP 400/401 on token refresh), the system SHALL mark the connection `authStatus: "reauth_required"`, record an unretryable `reauth_required` sync outcome on `PlayerConnectionSync`, and skip automatic scheduled refreshes until the user completes the redirect authentication flow again.

#### Scenario: User revokes GameNode access in Microsoft account settings
- **WHEN** background synchronization attempts to refresh the user's Xbox OAuth token and Microsoft returns `invalid_grant`
- **THEN** the connection is marked `authStatus: "reauth_required"`, the sync attempt terminates without transient retries, and subsequent `registerDueJobs` cycles skip the connection until re-authenticated

#### Scenario: User reconnects an account in reauth_required state
- **WHEN** a user with `authStatus: "reauth_required"` completes the Xbox redirect authentication flow
- **THEN** the encrypted credentials are replaced, `authStatus` resets to `"connected"`, and synchronization eligibility is restored immediately

### Requirement: Catalog-scoped Xbox achievement lookup isolation
Catalog-level Xbox operations that are not tied to a specific user connection (`getAvailableAchievements`, `getPFNByProductId`, `getTitleIdByPFN`) SHALL NOT require the requesting viewer to have a linked Xbox connection. `getAvailableAchievements` SHALL use a system-level or shared valid XSTS credential with 24-hour caching.

#### Scenario: Unauthenticated or non-Xbox viewer views game achievements
- **WHEN** a caller without an Xbox connection requests available achievements for an Xbox game
- **THEN** `GameAchievementService` retrieves the game's achievement schema using the system catalog credential or cache without failing for missing user credentials
