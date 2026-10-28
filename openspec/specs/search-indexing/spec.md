# Search Indexing Specification

## Purpose

Own the Manticore search lifecycle alongside the main GameNode API so search can be deployed, rebuilt, and recovered without the separate search application repository.

## Requirements

### Requirement: Independent server-owned search deployment
This repository SHALL supply development and production configuration, engine configuration, and indexing instructions sufficient to operate search against the main MySQL database without files or running code from game-node-search. Production Manticore ports SHALL remain on the private application network and credentials SHALL come from deployment inputs.

#### Scenario: Fresh deployment
- **WHEN** an operator deploys this repository with a migrated MySQL database and documented environment inputs
- **THEN** games and users indexes can be built and all three search endpoints can serve requests without the sibling Go project

#### Scenario: Private engine
- **WHEN** production search services start
- **THEN** the public entry point is the main API and the engine has no published host ports or embedded production credentials

### Requirement: Complete game search documents
The games index SHALL derive each document from the persisted game ID, name, slug, alternative names, category, status, timestamps, cover, relation labels, relation IDs, and popularity statistics. Missing optional relations/statistics SHALL not exclude a game. Existing name matching settings SHALL be preserved.

#### Scenario: Sparse catalog game
- **WHEN** a persisted game lacks a cover, statistics, or genre relationships
- **THEN** rebuilding retains the game with empty optional values and zero popularity counters

#### Scenario: Relation filtering is indexed
- **WHEN** a game has several platforms, genres, and themes
- **THEN** its complete relation IDs are available for exact filtering without fetching the catalog into API memory

### Requirement: Public user index contents
The user index SHALL contain public profile userId and username and SHALL exclude credentials, email, bio, and private account data. Numeric engine document IDs SHALL be internal and never replace the public string userId.

#### Scenario: Public identity remains stable
- **WHEN** indexes are rebuilt after profiles are added, renamed, or deleted
- **THEN** results expose the current usernames with their original public userIds and deleted profiles disappear after the successful refresh

### Requirement: Initial and periodic index refresh
Indexes SHALL build initially and support a documented manual rebuild. Games SHALL refresh daily at 03:00 and users hourly at minute zero in documented UTC scheduling time. Rebuilds SHALL be owned by one indexing service rather than each API replica, and overlapping rebuilds SHALL be prevented.

#### Scenario: Multiple API replicas
- **WHEN** two API replicas run and a scheduled refresh becomes due
- **THEN** one indexing owner rebuilds the relevant indexes without duplicate full-table work

### Requirement: Preserve serving indexes on rebuild failure
Rebuilds SHALL publish new indexes only after successful completion and preserve the last serving indexes when a build fails. Operators SHALL be able to observe the failure and retry manually without deleting MySQL data or the serving index volume.

#### Scenario: MySQL fails during refresh
- **WHEN** an index rebuild fails because its database source is unavailable
- **THEN** existing search results remain served from the previous index and a logged failure identifies the unsuccessful refresh

#### Scenario: Recovered source
- **WHEN** the source recovers and a manual rebuild succeeds
- **THEN** updated records become searchable without API redeployment

### Requirement: Reversible API consolidation
The migration SHALL provide a cutover and rollback procedure retaining the old hostname and public request paths. The old Go API SHALL be retired only after compatibility, index correctness, refresh behavior, and representative combined API load are verified. Rollback SHALL preserve prior engine configuration and data until acceptance.

#### Scenario: Cutover succeeds
- **WHEN** legacy-host smoke checks and representative client requests pass against the main API
- **THEN** the separate Go API replicas can be stopped while existing clients continue to use search

#### Scenario: Cutover fails
- **WHEN** compatibility or capacity checks fail during rollout
- **THEN** traffic can return to the previous deployment without deleting database data or requiring a client release
