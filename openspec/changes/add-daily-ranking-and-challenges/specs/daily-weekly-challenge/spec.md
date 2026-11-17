# Spec Delta

## Purpose

Offers one harder puzzle per week, played with the Specs rules, and ranks each player against the people they follow on GameNode.

## ADDED Requirements

### Requirement: One weekly puzzle per week
The system SHALL publish one weekly challenge per São Paulo week, running from Monday 00:00 to the end of Sunday. It SHALL use the Specs rules (10 attempts, the Specs feedback and hint) and SHALL have its own sequential number, separate from daily Specs numbers.

#### Scenario: Monday reset
- **WHEN** the clock passes Monday 00:00 in São Paulo
- **THEN** the new week's challenge becomes the current one with the next weekly number

#### Scenario: Specs rules
- **WHEN** a player plays the weekly challenge
- **THEN** they have 10 attempts and receive the same feedback and hint as a daily Specs puzzle

### Requirement: Weekly challenge discovery
The today response SHALL include the current weekly challenge with its id, number, maximum attempts, the instant the week ends and, for a signed-in player who started it, their status and attempts. It SHALL be null when no challenge exists for the week. Future challenges SHALL NOT be playable or listed.

#### Scenario: Signed-in player who finished it
- **WHEN** a player who won this week's challenge in 4 attempts reads the today response
- **THEN** the weekly entry reports status won and 4 attempts

#### Scenario: Next week's challenge
- **WHEN** a player plays next week's challenge by id before Monday
- **THEN** the request is rejected as not found

### Requirement: Weekly challenge is separate from daily lists
The weekly challenge SHALL be played through the same play endpoint as daily puzzles. It SHALL NOT appear in the daily puzzle list, the archive or the daily ranking, and SHALL NOT earn daily ranking points. It SHALL appear in the player's results only when requested with its own kind.

#### Scenario: Archive
- **WHEN** a player reads the archive
- **THEN** no weekly challenge is listed

#### Scenario: Daily ranking
- **WHEN** a player wins the weekly challenge
- **THEN** their daily ranking points do not change

### Requirement: Friends ranking for the weekly challenge
A signed-in player SHALL be able to read the current week's challenge ranking containing themself and the players they follow who finished it within the week while signed in. Winners SHALL come first, ordered by fewer attempts, then by earlier finish; players who lost SHALL follow. Results imported from guest play and finishes after the week ended SHALL NOT appear.

#### Scenario: Friends ranking
- **WHEN** a player follows two players who won in 3 and 5 attempts and won in 4 attempts themself
- **THEN** the ranking lists them as 3, 4 and 5 attempts with the player second

#### Scenario: Followed player not finished
- **WHEN** a followed player has started but not finished the challenge
- **THEN** they do not appear in the ranking

#### Scenario: Without session
- **WHEN** a guest requests the weekly ranking
- **THEN** the request is rejected with a 401 error

### Requirement: Guests can play the weekly challenge
Guests SHALL be able to play the weekly challenge without saving progress, as with daily puzzles, and SHALL be able to import a finished guest play after signing in. Imported weekly results SHALL be saved but SHALL NOT appear in the friends ranking.

#### Scenario: Guest import
- **WHEN** a guest finishes the weekly challenge and imports it after signing in
- **THEN** the result is saved and the friends ranking does not include it
