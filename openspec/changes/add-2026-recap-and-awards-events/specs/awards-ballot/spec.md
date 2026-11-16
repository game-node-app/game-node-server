# Spec Delta

## Purpose

Defines the personal Awards ballot: what a voter sees about each nominee, which votes are accepted, how ballot progress and completion are reported, and how a ballot is shared.

## ADDED Requirements

### Requirement: Votes are restricted to nominees in nominations-enabled events
For an event with nomination dates, a vote in any category other than personal GOTY SHALL be accepted only for one of that category's nominees. Personal-GOTY votes SHALL accept any eligible game. Events without nomination dates SHALL keep accepting any eligible game.

#### Scenario: Vote for a non-nominee
- **WHEN** a user votes in the 2026 "Narrativa" category for an eligible game that is not one of its nominees
- **THEN** the request is rejected with 400 and no vote is stored

#### Scenario: Personal GOTY
- **WHEN** a user votes in the 2026 personal-GOTY category for an eligible game that is not nominated anywhere
- **THEN** the vote is stored

#### Scenario: Legacy event
- **WHEN** a user votes in an event without nomination dates during its voting period
- **THEN** existing eligibility rules apply unchanged

### Requirement: Votes are accepted only during voting
A vote SHALL be rejected with 400 before voting starts and after voting ends, with a message naming the reason. A repeated vote in the same category SHALL replace the previous one.

#### Scenario: Before voting starts
- **WHEN** a user votes during the nominations phase
- **THEN** the request is rejected with a message saying voting has not started

### Requirement: Ballot read with personal play context
`GET /v1/awards/:eventId/ballot` SHALL require authentication and return the event phase and every category in order, each with the user's vote (or null) and its nominees. Each nominee SHALL carry the user's play status, playtime seconds and rating (0–5, or null).

#### Scenario: Played nominee
- **WHEN** the user has 86 hours of recorded playtime and a 4.5 review for a nominee
- **THEN** that nominee has status `played`, 309600 playtime seconds and rating 4.5

#### Scenario: Planned nominee
- **WHEN** the user has the nominee in their library with status planned and no playtime
- **THEN** that nominee has status `planned`

#### Scenario: Unknown nominee
- **WHEN** the user has no library entry, playtime or review for a nominee
- **THEN** that nominee has status `not_played`, 0 playtime seconds and null rating

#### Scenario: Unauthenticated
- **WHEN** the ballot is requested without a session
- **THEN** the response is 401

### Requirement: Played status definition
A game SHALL count as played by a user when the user has playtime above zero for it, or a library entry with status playing, finished or dropped, or a started or finished date. Otherwise a library entry SHALL count as `planned`.

#### Scenario: Finished without playtime data
- **WHEN** a user marked a game finished but has no connected playtime source
- **THEN** the game counts as played with 0 playtime seconds

### Requirement: Ballot progress and played counts
The ballot SHALL report how many categories the user voted in and the total number of categories, and each category SHALL report how many of its nominees the user played.

#### Scenario: Partial ballot
- **WHEN** a user voted in 7 of 12 categories and played 4 of the 6 GOTY nominees
- **THEN** the ballot reports 7 voted of 12 and the GOTY category reports 4 played nominees

### Requirement: Personal-GOTY suggestion
The personal-GOTY category in the ballot SHALL include a suggested game id: among eligible games the user played in the event year, the one with the highest user rating, ties broken by most playtime in the year, or null when none exist.

#### Scenario: Highest-rated game suggested
- **WHEN** the user rated eligible games A 4.5 with 86 hours and B 4.5 with 32 hours in the year
- **THEN** the suggestion is game A

#### Scenario: No eligible played games
- **WHEN** the user played no eligible game in the event year
- **THEN** the suggestion is null

### Requirement: Public ballot sharing
`GET /v1/awards/:eventId/votes/:userId` SHALL be public and return the user's vote per category as category id and game id. A user with no votes SHALL get an empty list. An unknown event SHALL return 404.

#### Scenario: Shared ballot link
- **WHEN** a logged-out visitor opens a shared ballot for a user who voted in 8 categories
- **THEN** the 8 category and game pairs are returned

### Requirement: Ballot completion is trackable for achievements
Each accepted vote SHALL trigger achievement evaluation for both the participation metric and the ballot completion metric of the event year.

#### Scenario: Last category voted
- **WHEN** a user casts their vote in the last category they had not voted in
- **THEN** achievement evaluation runs for the ballot completion metric with the event year
