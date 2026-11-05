# Spec Delta

## Purpose

Select daily puzzle answers with a minimum level of critic coverage so casual players have a fairer chance, while retaining mode suitability and stable published puzzles.

## ADDED Requirements

### Requirement: Automatic answers meet the launch recognition gate
Every newly generated automatic answer SHALL have at least one external critic score recorded by IGDB. Missing or zero counts SHALL fail this gate. GameNode user reviews, IGDB community ratings, rating values, and local engagement SHALL NOT substitute for external critic coverage. The gate SHALL apply to cover, artwork, keywords, and specs modes.

#### Scenario: Boundary count qualifies
- **WHEN** a game has exactly one aggregated critic review and meets the other selection requirements
- **THEN** it qualifies for the recognition gate in every mode

#### Scenario: Unreviewed game has local popularity
- **WHEN** a game has a missing or zero critic-review count, even with positive local engagement or a high rating score
- **THEN** automatic generation excludes it in every mode

#### Scenario: GameNode users review an otherwise unreviewed game
- **WHEN** a game has GameNode user reviews but no external critic scores recorded by IGDB
- **THEN** those user reviews do not satisfy the answer-selection gate

### Requirement: Answers retain mode suitability and content restrictions
Automatic answers SHALL be main games without the excluded mature theme. Cover and artwork answers SHALL have a corresponding non-null image URL. Keyword answers SHALL have at least eight named keywords. Specs answers SHALL have a genre, platform, developer or publisher, and a release date no later than generation time.

#### Scenario: Recognition does not bypass missing clues
- **WHEN** a reviewed game lacks a required image, keyword count, or specs attribute for the requested mode
- **THEN** it is excluded from that mode

#### Scenario: Restricted category or theme
- **WHEN** a reviewed game is not a main game or has the excluded mature theme
- **THEN** it is excluded from all modes

### Requirement: Selection uses a bounded pool of qualifying answers
Generation SHALL randomly select from up to 1,000 qualifying games ordered by descending critic-review count, with game ID ascending to break ties. Recognition, mode, content, and repeat filters SHALL apply before the pool limit. A qualifying game SHALL NOT require a local popularity ranking entry.

#### Scenario: No local ranking exists
- **WHEN** a game meets all selection requirements but has no local engagement ranking entry
- **THEN** it remains eligible for the bounded candidate pool

#### Scenario: Higher-ranked games lack mode metadata
- **WHEN** otherwise highly reviewed games lack metadata for the requested mode
- **THEN** they do not consume candidate-pool positions ahead of suitable games

### Requirement: Repeat avoidance never lowers the recognition gate
Generation SHALL exclude games already reserved for the same mode on dates later than 365 days before the target date, including queued future reservations. If no qualifying candidate remains, generation SHALL leave the slot unfilled and emit the existing warning, allowing a later scheduler run to retry. It SHALL NOT lower the review threshold or select from an unrestricted fallback.

#### Scenario: Same-mode answer was recently used
- **WHEN** a qualifying game has a same-mode puzzle dated later than the target date minus 365 days
- **THEN** it is excluded for the new slot

#### Scenario: Repeat window boundary
- **WHEN** its only same-mode reservation is exactly 365 days before the target date
- **THEN** that reservation does not exclude the game

#### Scenario: Another mode used the game
- **WHEN** a qualifying game has only a recent reservation in a different mode
- **THEN** that reservation does not exclude it

#### Scenario: Qualified pool is exhausted
- **WHEN** no candidate meets all requirements
- **THEN** generation warns and leaves the slot empty without selecting an unreviewed game

### Requirement: Policy changes preserve existing puzzles and progress
The recognition policy SHALL apply when generating new automatic puzzles. Deploying this policy SHALL NOT rewrite existing puzzle identities, answers, metadata, numbering, or saved results, including pre-generated future puzzles and manually authored puzzles.

#### Scenario: Deployment occurs with a populated queue
- **WHEN** existing puzzles include today's answer, historical answers, and future reservations
- **THEN** those puzzles and their results remain unchanged
- **AND** newly generated automatic slots use the recognition gate
