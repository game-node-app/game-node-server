# Spec Delta

## Purpose

Governs how users authenticate, link, configure, and store credentials for external gaming platform connections across redirect-based federated protocols, public identifier lookups, and delegated code exchanges.

## ADDED Requirements

### Requirement: Mode-enforced connection onboarding
The system SHALL enforce each provider's declared authentication mode (`redirect`, `public_identifier`, or `delegated_code`). Redirect providers (`steam`, `xbox`) SHALL only be linked via the redirect init/callback endpoints and SHALL reject manual `POST /v1/connections` requests with HTTP 400. Public-identifier providers (`psn`) SHALL only be linked via `POST /v1/connections` and SHALL reject redirect init/callback requests with HTTP 400.

#### Scenario: Manual identifier submitted for Steam or Xbox
- **WHEN** an authenticated user submits `POST /v1/connections` with `type` set to `steam` or `xbox`
- **THEN** the server rejects the request with HTTP 400 without querying the upstream provider or modifying any existing connection

#### Scenario: Redirect flow initiated for PSN
- **WHEN** an authenticated user requests `POST /v1/connections/psn/auth/init`
- **THEN** the server rejects the request with HTTP 400 indicating `psn` does not support redirect authentication

#### Scenario: PSN public identifier onboarding
- **WHEN** an authenticated user submits `POST /v1/connections` with `type: "psn"` and a valid `userIdentifier`
- **THEN** the server resolves the PSN account ID and online ID, persists the `UserConnection` with `authStatus: "connected"`, initializes synchronization state, and schedules initial synchronization

### Requirement: Anti-CSRF redirect state lifecycle
The system SHALL store a cryptographically random, single-use `state` token in Redis with a 10-minute TTL on `POST /v1/connections/:type/auth/init`, binding the initiating `userId`, connection `type`, validated auto-import preferences, and any protocol verifier. Callback completion (`POST /v1/connections/:type/auth/callback`) SHALL atomically consume the state and verify that the authenticated caller matches the initiating `userId` and `type`.

#### Scenario: Valid redirect initiation
- **WHEN** an authenticated user calls `POST /v1/connections/steam/auth/init` or `POST /v1/connections/xbox/auth/init` with valid optional auto-import settings
- **THEN** the server validates collection ownership if `autoImportCollectionId` is provided, stores the pending state in Redis for 10 minutes, and returns the provider's `authorizationUrl` pointing back to the frontend callback route

#### Scenario: Expired, unknown, or replayed state on callback
- **WHEN** `POST /v1/connections/:type/auth/callback` is called with a missing, expired, or already-consumed `state`
- **THEN** the server rejects the request with HTTP 400 and creates no connection

#### Scenario: Session mismatch on callback
- **WHEN** `POST /v1/connections/:type/auth/callback` is called with a valid `state` that was created by a different GameNode `userId` or for a different provider `type`
- **THEN** the server invalidates the state and rejects the request with HTTP 403

### Requirement: Verified Steam OpenID 2.0 callback
The system SHALL verify Steam callback parameters by sending a server-to-server `check_authentication` POST request to `https://steamcommunity.com/openid/login`, SHALL validate that `openid.claimed_id` and `openid.identity` match the canonical Steam OpenID URL format (`https://steamcommunity.com/openid/id/<steamid64>`), and SHALL resolve the user's current Steam nickname before persisting the connection.

#### Scenario: Forged or unverified Steam callback parameters
- **WHEN** a caller submits Steam OpenID parameters that Steam `check_authentication` does not confirm with `is_valid:true`
- **THEN** the server rejects the callback with HTTP 400 and does not link the account

#### Scenario: Valid Steam OpenID callback
- **WHEN** Steam confirms `is_valid:true` for a valid `steamid64`
- **THEN** the server fetches the Steam user summary, saves the `UserConnection` with `sourceUserId` set to `steamid64` and `authStatus: "connected"`, initializes sync state, and triggers initial synchronization

### Requirement: Decoupled connection settings update
The system SHALL allow authenticated users to update `isAutoImportEnabled` and `autoImportCollectionId` for an existing connection via `PATCH /v1/connections/:id` without re-running provider authentication or resetting synchronization eligibility.

#### Scenario: Updating auto-import preferences on an authenticated connection
- **WHEN** the connection owner submits `PATCH /v1/connections/:id` with updated `isAutoImportEnabled` and `autoImportCollectionId`
- **THEN** the server validates collection ownership, updates the connection settings in place, preserves stored credentials and `PlayerConnectionSync` cooldown state, and returns the updated connection DTO

#### Scenario: Updating another user's connection
- **WHEN** a user submits `PATCH /v1/connections/:id` for a connection they do not own
- **THEN** the server rejects the request with HTTP 404

### Requirement: Encrypted credential isolation and public DTO safety
The system SHALL store per-connection OAuth tokens and session claims in a dedicated `user_connection_credential` table encrypted at rest with AES-256-GCM using a 32-byte key from configuration. Public and owner connection endpoints (`GET /v1/connections/own`, `GET /v1/connections/user/:userId`) SHALL expose `authStatus` (`connected` | `reauth_required`) on `UserConnectionDto` and SHALL NEVER serialize encrypted or plaintext tokens, refresh tokens, or provider session claims.

#### Scenario: Public profile connection lookup
- **WHEN** any caller requests `GET /v1/connections/user/:userId` or `GET /v1/connections/own`
- **THEN** the response includes `authStatus` and capability flags but omits all fields from `user_connection_credential`

#### Scenario: Connection deletion cascades credentials
- **WHEN** a user deletes their connection via `DELETE /v1/connections/:id`
- **THEN** both the `user_connection` row and any associated `user_connection_credential` row are removed
