# Spec Delta

## Purpose

Defines how Awards results are computed and published, including the breakdown that counts only votes from people who played the game, and each user's personal scoreboard.

## ADDED Requirements

### Requirement: Results are computed once, on or after the results date
The system SHALL compute an event's results on the first lifecycle run at or after its results date and SHALL store at most one result per category. Results SHALL be computed from votes as they stand when computation starts and SHALL commit atomically per event.

#### Scenario: Several runs on results day
- **WHEN** the lifecycle tick runs four times on and after the results date
- **THEN** each category has exactly one stored result

#### Scenario: Missed results day
- **WHEN** no tick ran on the results date and the next one runs the following day
- **THEN** results are computed on that run

#### Scenario: Pre-existing duplicates
- **WHEN** the migration runs on a database with two results stored for one category
- **THEN** one result and its winners remain and the duplicate is removed

### Requirement: Winner ranking
Each category result SHALL rank voted games by vote count, ties broken by played-only vote count and then by lower game id. Position 1 SHALL be the winner. Every winner row SHALL include total votes and its share of the category's votes.

#### Scenario: Tie on votes
- **WHEN** two games have 100 votes each and 60 and 40 played-only votes
- **THEN** the game with 60 played-only votes is ranked first

### Requirement: Played-only breakdown
Each winner row SHALL include the number of its votes cast by voters who had played that game when results were computed, and that number as a share of the category's played-only votes. Each category result SHALL include its played-only vote total. Played SHALL follow the ballot's played-status definition.

#### Scenario: Played-only percentage
- **WHEN** a category has 1000 votes, of which 600 came from voters who played the game they voted for, and game A has 174 of those 600
- **THEN** game A's played-only share is 0.29

#### Scenario: No played-only votes
- **WHEN** no voter in a category played the game they voted for
- **THEN** the category's played-only total is 0 and every played-only share is 0

### Requirement: Results read
`GET /v1/awards/:eventId/results` SHALL stay public. Before computation it SHALL return an empty list; afterwards, one item per category with totals, played-only total and winners ordered by position. Existing fields SHALL keep their names and meaning.

#### Scenario: Before results date
- **WHEN** results are requested during voting
- **THEN** an empty list is returned

### Requirement: Personal scoreboard
`GET /v1/awards/:eventId/scoreboard/:userId` SHALL be public once results exist and return, for every category except personal GOTY, the user's voted game, the winning game and an outcome of `hit`, `miss` or `not_voted`, plus hits, voted and scorable totals.

#### Scenario: Seven hits out of eleven
- **WHEN** an event has 11 scorable categories and the user's vote matched the winner in 7, missed in 1 and was absent in 3
- **THEN** the scoreboard reports 7 hits, 8 voted and 11 scorable

#### Scenario: Requested before results
- **WHEN** the scoreboard is requested before results are computed
- **THEN** the response is 404

### Requirement: Shared personal GOTY count
The scoreboard SHALL include the user's personal-GOTY game, if any, and how many other users chose the same game as their personal GOTY in that event.

#### Scenario: Shared personal GOTY
- **WHEN** the user and 312 other users chose the same personal GOTY
- **THEN** the scoreboard's personal GOTY shows that game with 312 other users

#### Scenario: No personal GOTY
- **WHEN** the user did not vote in the personal-GOTY category
- **THEN** the scoreboard's personal GOTY is null
