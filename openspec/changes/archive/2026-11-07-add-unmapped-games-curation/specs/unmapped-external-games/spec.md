# Spec Delta

## Purpose

Keeps a queue of external platform games that GameNode could not map to a catalog game. Each entry records the game's name and which users own it, so moderators and admin agents can find and resolve the most important gaps first.

## ADDED Requirements

### Requirement: Unmapped registration from player syncs and imports
When a Steam, PSN, Xbox or Epic Games playtime sync or import sees a source ID with no mapping in that provider's category, the system SHALL register it as an unmapped entry keyed by source ID and category. Registering an existing entry SHALL NOT create a duplicate or change whether it is active.

#### Scenario: Xbox title without a mapping
- **WHEN** an Xbox playtime sync sees a product ID that has no `Microsoft` mapping
- **THEN** an active unmapped entry exists for that product ID and category `Microsoft`

#### Scenario: Same game seen again
- **WHEN** a second user's Steam sync sees an app ID that already has an active unmapped entry
- **THEN** no second entry is created for that app ID

#### Scenario: Resolved entry seen again
- **WHEN** a sync sees a source ID whose unmapped entry is inactive and which still has no mapping
- **THEN** the entry stays inactive

### Requirement: Unmapped entry name
An unmapped entry SHALL store the game's name as the provider reports it, when the provider reports one. A later registration that carries a name SHALL replace the stored name. A registration without a name SHALL keep the stored name. A missing name SHALL NOT prevent registration.

#### Scenario: Steam game name
- **WHEN** a Steam sync registers an unmapped app ID for a game Steam names "Hollow Knight"
- **THEN** the entry's name is "Hollow Knight"

#### Scenario: Epic namespace name
- **WHEN** an Epic sync registers an unmapped namespace and Epic's catalog service returns a title for the library item
- **THEN** the entry's name is that title

#### Scenario: Epic catalog lookup fails
- **WHEN** an Epic sync registers an unmapped namespace and the catalog title lookup fails
- **THEN** the entry is still registered, without a name, and the sync continues

#### Scenario: Registration without a name
- **WHEN** the Epic namespace bulk fill registers an ambiguous namespace that already has a name
- **THEN** the stored name is kept

### Requirement: Unmapped entry owners
The system SHALL record each user whose sync or import registered an unmapped entry, at most once per user and entry. Registrations not made for a user, such as the Epic namespace bulk fill, SHALL add no owner. Deleting a user SHALL remove their owner records.

#### Scenario: Two users own the same unmapped game
- **WHEN** two different users' syncs register the same unmapped PSN concept, each one more than once
- **THEN** the entry has an owner count of 2

#### Scenario: Owner deletes their account
- **WHEN** a user who owns an unmapped entry deletes their account
- **THEN** the entry's owner count drops by one

### Requirement: Moderator unmapped list
`GET /v1/game/external/unmapped`, restricted to `MOD` and `ADMIN`, SHALL return active unmapped entries that have no mapping of any origin for their source ID and category, in the standard paginated response shape. It SHALL accept an optional `category` filter. Entries SHALL be ordered by owner count, highest first, then by id. Each entry SHALL include id, source ID, category, name and owner count. Owner identities SHALL NOT be returned.

#### Scenario: Most-owned first
- **WHEN** a moderator requests the list and entry A has 5 owners while entry B has 2
- **THEN** A appears before B

#### Scenario: Category filter
- **WHEN** a moderator requests the list with `category` set to `EpicGamesNamespace`
- **THEN** only active Epic namespace entries are returned

#### Scenario: Regular user
- **WHEN** a user without the `MOD` or `ADMIN` role requests the list
- **THEN** the server responds HTTP 403

### Requirement: Dismiss unmapped entry
`POST /v1/game/external/unmapped/:id/dismiss`, restricted to `MOD` and `ADMIN`, SHALL mark an active unmapped entry inactive without creating a mapping. A dismissed entry SHALL stay inactive when it is registered again. An unknown or already inactive entry SHALL respond HTTP 404.

#### Scenario: Dismissing a soundtrack
- **WHEN** a moderator dismisses the active entry for a Steam soundtrack app
- **THEN** the entry is inactive, no mapping exists for it, and it no longer appears in the unmapped list

#### Scenario: Dismissed entry seen again
- **WHEN** a sync sees the source ID of a dismissed entry again
- **THEN** the entry stays inactive

#### Scenario: Dismissing an inactive entry
- **WHEN** a moderator dismisses an entry that is already inactive
- **THEN** the server responds HTTP 404 and nothing changes
