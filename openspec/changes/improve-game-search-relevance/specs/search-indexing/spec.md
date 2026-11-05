# Spec Delta

## MODIFIED Requirements

### Requirement: Complete game search documents
The games index SHALL derive each document from persisted game identity, names, category, status, timestamps, cover, relation labels/IDs, popularity statistics, and external critic-review count. Missing optional data SHALL NOT exclude a game. Null critic counts SHALL sort as zero. Indexed names SHALL support the search normalization and exact-title-or-individual-alias ordering contract while preserving original response values.

#### Scenario: Sparse catalog game
- **WHEN** a persisted game lacks a cover, statistics, genre relationships, or critic reviews
- **THEN** rebuilding retains the game with empty optional values and zero popularity and critic counters

#### Scenario: Relation filtering is indexed
- **WHEN** a game has several platforms, genres, and themes
- **THEN** its complete relation IDs are available for exact filtering without fetching the catalog into API memory

#### Scenario: External critic count is available for global ordering
- **WHEN** a rebuilt game has a persisted external critic-review count
- **THEN** that count is available to order the full matching set before pagination, independently of local views and likes

#### Scenario: Individual alias boundaries remain meaningful
- **WHEN** a game has multiple alternative names
- **THEN** every individual alias can qualify as an exact match and phrase matches cannot span adjacent aliases

## ADDED Requirements

### Requirement: Compatible game-name normalization
Game indexing SHALL support the same case, Latin accent, canonical Unicode, and within-word apostrophe equivalence as game queries. Original titles and response labels SHALL remain intact. Game-specific normalization SHALL NOT change username indexing or matching. Internal ranking fields SHALL NOT become required client inputs or new public response fields.

#### Scenario: Equivalent indexed spellings
- **WHEN** titles or aliases contain composed or decomposed Latin accents or straight or curly apostrophes
- **THEN** equivalent unaccented and omitted-apostrophe queries match them with consistent exact-match priority

#### Scenario: Rebuild preserves the public presentation
- **WHEN** an index rebuild adds normalized matching data
- **THEN** search still returns original names, identities, and relation labels in the existing response envelope

#### Scenario: User index is unaffected
- **WHEN** game normalization and ranking data change
- **THEN** user documents and username prefix-search behavior retain their existing contract
