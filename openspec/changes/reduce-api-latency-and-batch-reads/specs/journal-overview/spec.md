# Spec Delta

## Purpose

Serve a user's chronological journal overview with bounded payload size, optional year scoping, strict library visibility enforcement, and audience-partitioned caching.

## ADDED Requirements

### Requirement: Journal overview supports optional year filtering
`GET /v1/journal/overview/:userId` SHALL accept an optional `year` integer query parameter (1970–2100). When `year` is supplied, the response SHALL contain only status-date groups falling within that calendar year (returning `{ years: [] }` when none exist). When `year` is omitted, the endpoint SHALL return all years for backwards compatibility. Invalid `year` values SHALL be rejected with HTTP 400.

#### Scenario: Client requests a single journal year
- **WHEN** a caller requests `GET /v1/journal/overview/:userId?year=2026`
- **THEN** the response includes at most the `2026` year group containing only status dates from 2026

#### Scenario: Client omits year parameter
- **WHEN** a caller requests `GET /v1/journal/overview/:userId` without `year`
- **THEN** the response includes all accessible years matching the existing response schema

#### Scenario: Invalid year query is rejected
- **WHEN** a caller supplies `year=abc` or `year=1800`
- **THEN** the endpoint returns HTTP 400

### Requirement: Journal overview enforces library visibility with audience-partitioned caching
`GET /v1/journal/overview/:userId` SHALL enforce library and per-entry visibility for the viewer, returning `{ years: [] }` when inaccessible. Cached responses SHALL be partitioned by target user, library audience key (including hidden-game fingerprint), and `year` filter, falling back to the database on cache errors.

#### Scenario: Private entries are hidden from non-followers even with cache active
- **WHEN** the owner views their own journal overview (populating cache) and an anonymous or non-follower viewer subsequently requests the same endpoint
- **THEN** the viewer receives only entries permitted by their library access level and never sees cached private or followers-only entries

#### Scenario: Visibility change invalidates cached view for other audiences
- **WHEN** an owner changes an entry's visibility from `public` to `private`
- **THEN** subsequent anonymous reads compute a different audience key and no longer include that entry
