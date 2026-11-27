# Spec Delta

## Purpose

Serve catalog game lookups by identifier and release-window collections with accurate mature-content exclusion, bounded response payloads, and reusable per-game caching.

## ADDED Requirements

### Requirement: Release collections accept optional date bounds
`POST /v1/game/repository/collection` SHALL accept optional ISO-8601 `from` and `to` bounds to constrain `firstReleaseDate` inclusively. When omitted, `upcoming` SHALL default to releases on or after today (UTC) and `recently_released` to the trailing 30 days through today (UTC). Invalid dates or `from > to` SHALL return HTTP 400.

#### Scenario: Upcoming strip requests a 30-day window
- **WHEN** a client requests `collectionType: "upcoming"` with `from` set to today and `to` set to 30 days later
- **THEN** only eligible games whose `firstReleaseDate` falls within `[from, to]` are returned in ascending `firstReleaseDate` order with accurate pagination totals

#### Scenario: Date bounds are omitted
- **WHEN** a client omits both `from` and `to` for `upcoming` or `recently_released`
- **THEN** the endpoint applies the existing default release window without breaking existing callers

#### Scenario: Inverted or malformed date bounds are rejected
- **WHEN** a client supplies `from` later than `to` or an invalid date string
- **THEN** the endpoint responds with HTTP 400 without executing the catalog query

### Requirement: Release collections return lean game projections
`POST /v1/game/repository/collection` SHALL return only `id`, `name`, `slug`, `category`, `status`, `firstReleaseDate`, and `summary` on each game, omitting unused fields (`storyline`, `url`, `checksum`, internal IDs, and timestamps). Requested `cover` and `platforms` relations SHALL project only their rendering fields (`cover`: `id`, `imageId`, `url`, `width`, `height`, `gameId`; `platforms`: `id`, `name`, `abbreviation`).

#### Scenario: Upcoming collection omits heavy unused columns
- **WHEN** a client requests `POST /v1/game/repository/collection` with `relations: { cover: true, platforms: true }`
- **THEN** each returned game includes `id`, `name`, `slug`, `category`, `status`, `firstReleaseDate`, `summary`, slim `cover`, and slim `platforms`
- **AND** `storyline`, `url`, `checksum`, and unused platform/cover metadata fields are absent

### Requirement: Release collections exclude mature games accurately
Release collection queries SHALL exclude any game associated with the mature theme regardless of what other themes it carries, and SHALL include eligible games that have no themes assigned.

#### Scenario: Game has both mature and non-mature themes
- **WHEN** an upcoming game is tagged with both the mature theme and Action
- **THEN** it is absent from the collection results and pagination total

#### Scenario: Game has no themes assigned
- **WHEN** an eligible upcoming game has zero rows in the game-theme relationship
- **THEN** it remains eligible in the collection results and pagination total

### Requirement: Release collection responses are cached
`POST /v1/game/repository/collection` SHALL cache identical normalized query results for a bounded TTL so repeated home and calendar loads do not re-query the database. Cache failures SHALL fall back to the database transparently.

#### Scenario: Repeated upcoming requests reuse cache
- **WHEN** two clients submit identical release collection parameters within the cache TTL
- **THEN** the second request serves the cached result without querying the catalog database

### Requirement: Batch game reads cache individually by game and relation shape
`POST /v1/game/repository` SHALL cache games individually by `(gameId, canonicalRelations)`, sharing entries with `POST /v1/game/repository/:id`. Batches SHALL query the database only for missed IDs, preserve requested ID order, return HTTP 400 on empty `gameIds` and HTTP 404 when no IDs match, and apply cover personalization after reading shared cache.

#### Scenario: Overlapping batches reuse cached games
- **WHEN** request A loads games `[1, 2, 3]` with `relations: { cover: true }` and request B loads `[2, 3, 4]` with the same relations
- **THEN** games `2` and `3` are served from cache and only game `4` is queried from the database
- **AND** the response preserves the order `[2, 3, 4]`

#### Scenario: Equivalent relation objects with different key order share cache
- **WHEN** two requests specify `{ cover: true, platforms: true }` and `{ platforms: true, cover: true }`
- **THEN** both resolve to the same per-game cache keys

#### Scenario: Personalized covers do not pollute shared game cache
- **WHEN** a signed-in user requests `personalizeCovers: true` for a game
- **THEN** custom covers are applied after reading the shared per-game cache so subsequent anonymous or other-user reads receive the default cover
