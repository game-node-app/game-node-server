# Spec Delta

## Purpose

Defines the yearly Recap: when it opens and closes, how it is kept current while the year is still running, and the data clients use to render the Recap page, stories and Home card.

## ADDED Requirements

### Requirement: Recap window and phases
The Recap for year Y SHALL open at its stored opening time, defaulting to 15 November of Y 00:00 UTC when none is stored. It SHALL be `live` until 31 December of Y ends (UTC) and `closed` afterwards. Before Y opens, the current Recap year SHALL be Y−1.

#### Scenario: Default opening
- **WHEN** no opening time is stored for 2026 and the current time is 15 Nov 2026 00:00 UTC
- **THEN** the current Recap year is 2026 with phase `live`

#### Scenario: Before opening
- **WHEN** the 2026 opening is 15 Nov and the current time is 10 Nov 2026
- **THEN** the current Recap year is 2025 with phase `closed`

#### Scenario: After the year ends
- **WHEN** the current time is 2 Jan 2027
- **THEN** the current Recap year is 2026 with phase `closed`

### Requirement: Opening time is editable without a deploy
Admins SHALL be able to set or change the opening time of a Recap year through an admin-only endpoint. The opening time SHALL fall within that year. The change SHALL take effect within one minute without a restart. Non-admins SHALL receive 403.

#### Scenario: Postpone opening
- **WHEN** an admin sets the 2026 opening to 1 Dec 2026 on 14 Nov
- **THEN** from then on the current Recap year is 2025 until 1 Dec 2026, and daily generation for 2026 does not start before it

#### Scenario: Opening outside the year
- **WHEN** an admin sets the 2026 opening to 5 Jan 2027
- **THEN** the request is rejected with 400

#### Scenario: Non-admin
- **WHEN** a regular user calls the endpoint
- **THEN** the response is 403

### Requirement: Current recap lookup
`GET /v1/recap/current` SHALL be public and return the current Recap year, its phase, its opening date and its closing date. The status read SHALL also include the phase of the requested year.

#### Scenario: Status during the live window
- **WHEN** a client requests the 2026 status for a user on 20 Nov 2026
- **THEN** the response includes phase `live` alongside the existing created and eligible flags

### Requirement: Daily regeneration while live
While a year is live, the system SHALL generate a Recap at least daily for each eligible user without one, and regenerate it for users with playtime, library or review changes since their last generation. Regeneration SHALL replace the previous data atomically.

#### Scenario: Second generation
- **WHEN** a user's 2026 Recap exists and they played a game since it was generated
- **THEN** the next daily run replaces it with current data, without error and without duplicate played-game rows

#### Scenario: Inactive user
- **WHEN** a user's 2026 Recap exists and nothing changed since it was generated
- **THEN** the daily run does not regenerate it

#### Scenario: Failure mid-regeneration
- **WHEN** regeneration fails after removing old rows
- **THEN** the previous Recap remains readable unchanged

### Requirement: Final generation when the year closes
After a year closes, the system SHALL regenerate each eligible user's Recap for that year once more, mark it final, and never regenerate a final Recap. The read SHALL expose whether it is final and when it was generated.

#### Scenario: First run in January
- **WHEN** the daily run executes on 1 Jan 2027
- **THEN** every non-final 2026 Recap is regenerated with data through 31 Dec 2026 and marked final

#### Scenario: Final recap later
- **WHEN** a user with a final 2026 Recap adds playtime in February 2027
- **THEN** the 2026 Recap is unchanged

### Requirement: Recap totals
The Recap read SHALL include played, finished, dropped and added game counts and total playtime for the year, plus backlog growth defined as added minus finished minus dropped, floored at zero.

#### Scenario: Backlog numbers
- **WHEN** a user added 52 games, finished 14 and dropped 6 in the year
- **THEN** the read reports backlog growth of 32

### Requirement: Daily playtime calendar
The Recap read SHALL include playtime seconds for every day of the year, estimated by attributing each playtime increment to the UTC day it was observed. Days in the future or without play SHALL be 0.

#### Scenario: Leap year length
- **WHEN** the Recap year is 2028
- **THEN** the daily list has 366 entries

### Requirement: Derived calendar highlights
From the daily playtime, the read SHALL include 12 monthly totals, the top month, the longest run of consecutive days with play (start, end, length), the weekday with the most playtime with its share, and the weekend share of total playtime.

#### Scenario: Longest streak
- **WHEN** a user played every day from 2 to 24 March and on no longer run of consecutive days
- **THEN** the longest streak is 23 days from 2 Mar to 24 Mar

#### Scenario: No playtime
- **WHEN** a user has no playtime in the year
- **THEN** the top month, streak and top weekday are null and all monthly totals are 0

### Requirement: Played game details
Each played game in the Recap SHALL include the first day it was played in the year, its finish date in the year if any, and the user's rating if any. When no playtime increment exists, the first-played day SHALL fall back to the library start date.

#### Scenario: Game of the year card
- **WHEN** a user played a game for 86 hours, finished it on 14 Mar and rated it 4.5
- **THEN** that played game has its first-played date, finish date 14 Mar and rating 4.5

### Requirement: Aggregated top games and platform hours
The read SHALL include played games aggregated per game (summing all platforms, ordered by playtime, with share of total), and total playtime and share per platform.

#### Scenario: Same game on two sources
- **WHEN** a user played a game on Steam and on PC through another source
- **THEN** it appears once in the aggregated list with the summed playtime

### Requirement: Community comparison highlights
The read SHALL include up to two highlights among the user's rated games played in the year with at least 20 other reviews: the largest gap between the user's rating and the community average, and the smallest. Each highlight SHALL include ratings, review count and the agreement numbers.

#### Scenario: Minority opinion
- **WHEN** the user rated a game 4.5, its community average is 3.2, and 12% of other reviewers rated it 4.5 or higher
- **THEN** the minority highlight shows that game, 4.5, 3.2 and a share of 0.12 at or beyond the user's rating

#### Scenario: In tune
- **WHEN** the user's smallest gap is on a game they rated 4.75 with community average 4.65 and 2140 other reviewers within 0.5 of 4.75
- **THEN** the in-tune highlight shows that game with 2140 reviewers in the same range

#### Scenario: Not enough reviews
- **WHEN** none of the user's rated games has 20 other reviews
- **THEN** both highlights are null

### Requirement: Recap reads stay public
The Recap read and status SHALL remain readable without authentication so that shared Recap links work for logged-out visitors.

#### Scenario: Shared story link
- **WHEN** a logged-out visitor opens a shared 2026 Recap
- **THEN** the full Recap data is returned

### Requirement: Recap availability notifications
When a user's first Recap for a live year is generated with any played or added game, the system SHALL notify them once. When a Recap with data is marked final, the system SHALL notify them once that their year closed.

#### Scenario: First generation with data
- **WHEN** a user's first 2026 Recap is generated on 15 Nov with 38 played games
- **THEN** the user receives one "your Recap is here" notification

#### Scenario: Empty recap
- **WHEN** a user's first Recap has no played or added games
- **THEN** no availability notification is sent
