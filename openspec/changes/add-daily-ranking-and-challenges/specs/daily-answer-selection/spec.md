# Spec Delta

## ADDED Requirements

### Requirement: Weekly challenge answers come from a deeper pool
Weekly challenge answers SHALL meet the same recognition, Specs suitability and content restrictions as daily Specs answers. They SHALL be selected randomly from qualifying games at positions 501 to 2,500 when ordered by descending critic-review count and ascending game id, so the most reviewed games are left to the daily.

#### Scenario: Very well known game
- **WHEN** a qualifying game is among the 500 most reviewed qualifying games
- **THEN** it is not chosen for the weekly challenge

#### Scenario: Unreviewed game
- **WHEN** a game has no external critic score
- **THEN** it is not chosen for the weekly challenge

### Requirement: Weekly and daily Specs answers do not repeat each other
Repeat avoidance for Specs SHALL treat daily Specs puzzles and weekly challenges as one history: a game reserved for either within the 365-day window SHALL be excluded from both, including queued future reservations.

#### Scenario: Recent daily Specs answer
- **WHEN** a game was the daily Specs answer 100 days ago
- **THEN** it is excluded from the weekly challenge

#### Scenario: Queued weekly answer
- **WHEN** a game is reserved for next week's challenge
- **THEN** it is excluded from daily Specs generation

### Requirement: Practice answers use the daily pool without reservations
Practice rounds SHALL pick randomly from the same bounded pool of qualifying games as the daily puzzle of the same mode, without the 365-day repeat window, but excluding every game reserved for a daily puzzle dated today or later and for the current or a future weekly challenge, in any mode.

#### Scenario: Recently used daily answer
- **WHEN** a qualifying game was a daily Cover answer last month
- **THEN** it can be chosen for Cover practice

#### Scenario: No candidate left
- **WHEN** no qualifying practice candidate remains
- **THEN** starting a round responds with a 503 error and no round is created
