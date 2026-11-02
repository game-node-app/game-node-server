# Epic Games Sync Specification

## Purpose

Links a user's Epic Games account to GameNode and keeps that user's Epic library and playtime in sync, using the user's own Epic credentials.

## Requirements

### Requirement: Epic account linking by delegated code
The `epicgames` provider SHALL use `delegated_code` onboarding. `auth/init` SHALL return an Epic login URL that shows the user a one-time authorization code. `auth/callback` SHALL accept that code (raw, or the JSON page body containing `authorizationCode`), exchange it for Epic tokens and link the Epic account ID and display name.

#### Scenario: Valid pasted code
- **WHEN** the user submits `POST /v1/connections/epicgames/auth/callback` with a valid state and `callbackParams.code` set to the code or to the JSON body Epic displayed
- **THEN** the server stores the connection with `sourceUserId` set to the Epic account ID, `sourceUsername` set to the Epic display name and `authStatus: "connected"`, stores the tokens encrypted, and schedules initial synchronization

#### Scenario: Malformed, expired or reused code
- **WHEN** the code is missing, malformed, or rejected by Epic
- **THEN** the server responds HTTP 400, creates no connection and stores no credentials

### Requirement: Epic token lifecycle
Before a player-scoped Epic call, the system SHALL refresh an access token that expires within five minutes, using the stored refresh token. It SHALL persist the rotated tokens, and SHALL allow only one refresh at a time per connection. If Epic rejects the refresh token, the connection SHALL become `reauth_required` and background sync for it SHALL stop.

#### Scenario: Concurrent syncs with an expiring token
- **WHEN** two sync stages for the same Epic connection need a token while the stored access token is about to expire
- **THEN** exactly one refresh request is sent to Epic and both stages use the refreshed token

#### Scenario: Revoked or expired refresh token
- **WHEN** Epic rejects the refresh token as invalid or expired
- **THEN** the connection's `authStatus` becomes `reauth_required` and further background Epic syncs for it are skipped until the user reconnects

### Requirement: Epic library import
Library discovery for `epicgames` SHALL read every page of the user's Epic library, collapse items by namespace, skip Unreal Engine marketplace items, and match namespaces through `EpicGamesNamespace` mappings. Matched games SHALL use the PC platform. Unmatched namespaces SHALL be registered as unmapped entries.

#### Scenario: Game with add-ons in the library
- **WHEN** the user's library contains a base game and two of its add-ons, all in one namespace that is mapped to a catalog game
- **THEN** the importer lists that catalog game once, on the PC platform

#### Scenario: Unmapped namespace
- **WHEN** a library namespace has no mapping
- **THEN** it is not listed for import and is registered as an active unmapped entry for category `EpicGamesNamespace`

#### Scenario: Already processed entry
- **WHEN** the user already imported or ignored a matched Epic game
- **THEN** it is not listed again unless processed entries are explicitly included

### Requirement: Epic playtime import
Playtime import for `epicgames` SHALL read the account's total playtime per app and attribute it to the app's namespace from the library, then to the mapped catalog game on the PC platform. It SHALL sum apps that map to the same game. When a game's stored total increases, its last played date SHALL be set to the sync time.

#### Scenario: First playtime import
- **WHEN** Epic reports 7,200 seconds for an app whose namespace maps to a catalog game and no Epic playtime exists for that game
- **THEN** a PC playtime record of 7,200 seconds is stored for the game with source `epicgames`

#### Scenario: Playtime increased since last sync
- **WHEN** Epic reports a higher total for a game than the stored Epic playtime
- **THEN** the stored total is updated and its last played date is set to the sync time

#### Scenario: App not in the library
- **WHEN** Epic reports playtime for an app that the library listing does not contain
- **THEN** that playtime entry is skipped

### Requirement: Per-user Epic rate-limit scope
Player-scoped Epic calls SHALL be budgeted per Epic account, so a throttling response for one user's calls SHALL NOT delay other users' Epic syncs.

#### Scenario: One user throttled
- **WHEN** Epic responds HTTP 429 to a call made with one user's token
- **THEN** the cooldown applies only to that Epic account's budget scope
