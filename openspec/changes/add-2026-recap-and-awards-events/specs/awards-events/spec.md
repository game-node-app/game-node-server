# Spec Delta

## Purpose

Defines an Awards event's calendar and phases, how clients find the current event, and how community nominations become the nominees each category is voted on.

## ADDED Requirements

### Requirement: Event calendar with optional nominations phase
An Awards event SHALL store voting start and end, results date, and optionally a nominations start and end and a release cutoff date. When set, nomination dates SHALL precede voting start and end before it; admin saves violating the order SHALL be rejected. Events without nomination dates SHALL keep their existing behavior.

#### Scenario: Valid 2026 calendar
- **WHEN** an admin saves an event with nominations 3–16 Nov, voting 1–20 Dec and results on 27 Dec
- **THEN** the event is stored with all five dates

#### Scenario: Nominations end after voting starts
- **WHEN** an admin saves an event whose nominations end after voting starts
- **THEN** the request is rejected with 400 and nothing is saved

#### Scenario: Legacy event
- **WHEN** an event has no nomination dates
- **THEN** nominations are unavailable for it and its vote rules are unchanged

### Requirement: Derived event phase
Every event read SHALL include a `phase` derived from the current time: `upcoming` before the first phase, `nominations`, `nominations_closed` until voting, `voting`, `voting_closed` until results, and `results` from the results date on. An event without nomination dates SHALL never report `nominations` or `nominations_closed`.

#### Scenario: Gap between phases
- **WHEN** an event with nominations ending 16 Nov and voting starting 1 Dec is read on 20 Nov
- **THEN** its phase is `nominations_closed`

#### Scenario: After results
- **WHEN** the event is read on 15 Jan of the next year
- **THEN** its phase is `results`

### Requirement: Current event lookup
`GET /v1/awards/events/current` SHALL be public and return the latest event, by year, whose first phase has started, with its dates, phase and categories count. It SHALL return 404 when no event has started.

#### Scenario: January after the event
- **WHEN** the 2026 event is the latest started event and the request is made on 10 Jan 2027
- **THEN** the 2026 event is returned with phase `results`

#### Scenario: Next event scheduled but not started
- **WHEN** a 2027 event exists whose nominations start in the future
- **THEN** the 2026 event is still returned

### Requirement: Game eligibility
A game SHALL be eligible for an event when its first release date falls in the event year and, if a release cutoff is set, on or before the cutoff. Games with no release date SHALL be eligible, as they are today.

#### Scenario: Released after cutoff
- **WHEN** the cutoff is 30 Nov 2026 and a game was released on 5 Dec 2026
- **THEN** nominating or voting for it is rejected with 400

### Requirement: Users nominate up to three games per category
During the nominations phase, an authenticated user SHALL be able to replace their nominations for one category with 0 to 3 distinct eligible games. The personal-GOTY category SHALL NOT accept nominations. Requests outside the phase SHALL be rejected with 400.

#### Scenario: Replace nominations
- **WHEN** a user who nominated games A and B submits games B and C for the same category
- **THEN** their nominations for that category become exactly B and C

#### Scenario: Too many games
- **WHEN** a user submits 4 games for a category
- **THEN** the request is rejected with 400 and existing nominations are unchanged

#### Scenario: Clear nominations
- **WHEN** a user submits an empty list
- **THEN** their nominations for that category are removed

#### Scenario: Personal GOTY
- **WHEN** a user submits nominations for the personal-GOTY category
- **THEN** the request is rejected with 400

#### Scenario: Nominations closed
- **WHEN** a user submits nominations after the nominations end date
- **THEN** the request is rejected with 400

### Requirement: Users read their own nominations
`GET /v1/awards/:eventId/nominations/me` SHALL return, for an authenticated user, every category of the event that accepts nominations with the game ids that user nominated, in category order. Other users' nominations SHALL NOT be exposed individually.

#### Scenario: Partially nominated
- **WHEN** a user nominated games in 2 of 11 categories
- **THEN** all 11 categories are returned and 9 have an empty list

### Requirement: Nominees are finalized from nominations
After nominations end, each nominations-enabled category without nominees SHALL receive its top `nomineeCount` (default 6) games by distinct nominating users, ties broken by lower game id. Finalization SHALL run once per category. Categories that already have nominees SHALL keep them.

#### Scenario: Automatic finalization
- **WHEN** nominations have ended and a category with `nomineeCount` 6 received nominations for 9 games
- **THEN** the 6 games nominated by the most users become its nominees

#### Scenario: Admin-curated category
- **WHEN** an admin added nominees to a category before nominations ended
- **THEN** finalization leaves that category's nominees unchanged

#### Scenario: Repeated tick
- **WHEN** the lifecycle tick runs again after a category was finalized
- **THEN** the category's nominees are unchanged

#### Scenario: Fewer nominated games than slots
- **WHEN** only 4 distinct games were nominated in a category
- **THEN** those 4 games become its nominees

### Requirement: Nominees remain admin-editable
Admins SHALL be able to add and remove a category's nominees through the existing suggestion endpoints, and to set `nomineeCount` per category. The public categories read SHALL keep returning nominees in its `suggestions` field.

#### Scenario: Admin replaces a nominee
- **WHEN** an admin removes a finalized nominee and adds another eligible game before voting starts
- **THEN** the public categories read and the ballot show the new nominee
