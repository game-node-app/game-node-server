# Spec Delta

## MODIFIED Requirements

### Requirement: Mapping origin and reserved identity
Every external game mapping SHALL record its origin: `igdb` for rows from the IGDB catalog sync, `bulk` for rows written by a bulk fill job, `curated` for rows written by a moderator, `agent` for rows written by an admin's agent through the MCP mapping tools. Non-IGDB rows SHALL use identifiers from a range reserved for GameNode that cannot collide with IGDB external game identifiers. Existing rows SHALL be treated as `igdb`.

#### Scenario: Existing rows after migration
- **WHEN** the migration that introduces mapping origin runs
- **THEN** every pre-existing external game row has origin `igdb` and keeps its identifier

#### Scenario: GameNode row identifier
- **WHEN** a `bulk`, `curated` or `agent` mapping is created
- **THEN** its identifier lies in the GameNode-reserved range and no existing IGDB row is overwritten

### Requirement: IGDB catalog sync preserves GameNode mappings
When the IGDB catalog sync reconciles a game's external games, it SHALL compare and replace only `igdb` rows. Rows with origin `bulk`, `curated` or `agent` SHALL NOT be removed, detached or modified, and SHALL NOT force a reconciliation by themselves.

#### Scenario: Re-syncing a game with a curated mapping
- **WHEN** a game has a `curated` Epic namespace mapping and the IGDB sync processes that game with an external games list that does not contain it
- **THEN** the `curated` mapping remains attached to the game and the game's IGDB external games are reconciled as before

#### Scenario: Re-syncing a game with an agent mapping
- **WHEN** a game has an `agent` Steam mapping and the IGDB sync processes that game with an external games list that does not contain it
- **THEN** the `agent` mapping remains attached to the game

### Requirement: Moderator mapping submission
`POST /v1/game/external`, restricted to `MOD` and `ADMIN`, SHALL create or update a `curated` mapping keyed by source ID and category. Updating a non-IGDB mapping SHALL set its origin to `curated`. It SHALL NOT replace the game's other mappings of the same category. If an `igdb` row already maps that source ID and category, it SHALL respond HTTP 409. A matching active unmapped entry SHALL be deactivated.

#### Scenario: Adding a second mapping for the same game and category
- **WHEN** a moderator submits a mapping for a game that already has a different mapping in the same category
- **THEN** both mappings exist afterward

#### Scenario: Correcting a curated mapping
- **WHEN** a moderator submits a source ID and category that already has a `curated` mapping, with a different game
- **THEN** that mapping now points to the new game and no new row is created

#### Scenario: Correcting an agent mapping
- **WHEN** a moderator submits a source ID and category that already has an `agent` mapping, with a different game
- **THEN** that mapping now points to the new game, its origin is `curated`, and no new row is created

#### Scenario: Shadowing an IGDB mapping
- **WHEN** a moderator submits a source ID and category that an `igdb` row already maps
- **THEN** the server responds HTTP 409 and nothing changes

#### Scenario: Resolving an unmapped entry
- **WHEN** a moderator submits a mapping whose source ID and category match an active unmapped entry
- **THEN** the mapping is created and the unmapped entry becomes inactive
