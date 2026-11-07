# External Game Mapping Specification

## Purpose

Maintains GameNode-owned mappings from external platform game identifiers to catalog games, so that imports can match platforms and identifier types that IGDB does not map, while IGDB-sourced mappings stay authoritative and unchanged.

## Requirements

### Requirement: Mapping origin and reserved identity
Every external game mapping SHALL record its origin: `igdb` for rows from the IGDB catalog sync, `bulk` for rows written by a bulk fill job, `curated` for rows written by a moderator, `agent` for rows written by an admin's agent through the MCP mapping tools. Non-IGDB rows SHALL use identifiers from a range reserved for GameNode that cannot collide with IGDB external game identifiers. Existing rows SHALL be treated as `igdb`.

#### Scenario: Existing rows after migration
- **WHEN** the migration that introduces mapping origin runs
- **THEN** every pre-existing external game row has origin `igdb` and keeps its identifier

#### Scenario: GameNode row identifier
- **WHEN** a `bulk`, `curated` or `agent` mapping is created
- **THEN** its identifier lies in the GameNode-reserved range and no existing IGDB row is overwritten

### Requirement: GameNode-only mapping categories
The system SHALL support mapping categories that IGDB does not define, using values outside IGDB's external game source range. `EpicGamesNamespace` SHALL map an Epic Games catalog `namespace` to a catalog game. `NintendoTitleId` SHALL map a 16-hex Nintendo Switch title ID to a catalog game.

#### Scenario: Looking up an Epic namespace
- **WHEN** an importer looks up mappings for category `EpicGamesNamespace` and source ID `9773aa1aa54f4f7b80e44bef04986cea`
- **THEN** the system returns the catalog game mapped to that namespace, if one exists

#### Scenario: Looking up a Nintendo title ID
- **WHEN** an importer looks up mappings for category `NintendoTitleId` and source ID `0100BA0018500000`
- **THEN** the system returns the catalog game mapped to that title ID, if one exists

#### Scenario: Curating a Nintendo title
- **WHEN** an admin maps an active `NintendoTitleId` unmapped entry to a catalog game, through the moderator endpoint or the MCP mapping tool
- **THEN** a non-IGDB mapping for that title ID exists, and later Nintendo imports of any user match it

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

### Requirement: Epic namespace bulk fill
An `ADMIN`-only endpoint SHALL start a single background job that, for each IGDB Epic store mapping with a store page URL, resolves the page's Epic namespace and writes a `bulk` `EpicGamesNamespace` mapping. Only one job SHALL run at a time. Re-running SHALL NOT duplicate mappings or overwrite `curated` ones.

#### Scenario: Unambiguous namespace
- **WHEN** the job resolves every store page that leads to a namespace to the same catalog game
- **THEN** a `bulk` mapping from that namespace to the game exists after the job

#### Scenario: Ambiguous namespace
- **WHEN** store pages that lead to one namespace belong to more than one main catalog game
- **THEN** no mapping is written for that namespace and it is registered as an active unmapped entry for moderators

#### Scenario: Base game and add-ons share a namespace
- **WHEN** a namespace's store pages belong to one main game and to add-on or edition games
- **THEN** the namespace is mapped to the main game

#### Scenario: Starting a second run while one is active
- **WHEN** an admin triggers the bulk fill while a previous run is still active
- **THEN** no second run starts and the response reports the existing run

#### Scenario: Existing curated mapping
- **WHEN** the job resolves a namespace that already has a `curated` mapping
- **THEN** the `curated` mapping is left unchanged

#### Scenario: Store page that cannot be resolved
- **WHEN** Epic's store content service returns no namespace for a slug or fails for it
- **THEN** the job skips that slug, records it in the run summary and continues
