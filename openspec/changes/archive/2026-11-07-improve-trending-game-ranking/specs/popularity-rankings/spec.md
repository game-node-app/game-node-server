# Spec Delta

## ADDED Requirements

### Requirement: Game rankings require external recognition
Game rankings SHALL include only games with at least one external critic review, or whose first release date is after the ranking's calculation time. Games with a null or zero critic count and a past or unknown release date SHALL be excluded. This eligibility SHALL apply to every game ranking request, together with explicit criteria, and SHALL NOT apply to review rankings.

#### Scenario: Unreviewed released game has the highest score
- **WHEN** a released game without critic reviews has more engagement than every reviewed game
- **THEN** it is absent from the game ranking and its total

#### Scenario: Upcoming game has engagement
- **WHEN** a game with no critic reviews has a first release date after the calculation time and a positive score
- **THEN** it is ranked by the same ordering as reviewed games

#### Scenario: Game has no known release date
- **WHEN** a game with no critic reviews has no first release date
- **THEN** it is excluded

#### Scenario: Explicit criteria select an unreviewed game
- **WHEN** a request's ID, category, status, or relation criteria match only a released unreviewed game
- **THEN** the ranking is empty and its total is zero

## MODIFIED Requirements

### Requirement: Filters apply to the complete eligible source population
Game and review rankings SHALL apply current eligibility and their supported domain filters before limiting or paginating results. A fixed unfiltered top-N SHALL NOT remove otherwise matching sources. Game rankings SHALL include only games with a positive score. Review sources with zero interactions SHALL remain eligible with zero score and deterministic tie-breaking.

#### Scenario: Matching game lies outside the first unfiltered page
- **WHEN** a matching game has a lower score than the games on the first unfiltered page
- **THEN** it remains eligible in the filtered ranking and its total

#### Scenario: Review filters are combined
- **WHEN** game, author, and exclude-own filters are supplied
- **THEN** the ranking and its total describe their combined permitted result set

#### Scenario: Dataset contains zero-score sources
- **WHEN** matching eligible review sources have no interactions
- **THEN** they appear with zero score under the same stable native-identity tie-breaker

#### Scenario: Dataset contains zero-score games
- **WHEN** otherwise eligible games have no interactions in the interval
- **THEN** they are absent from the game ranking and its total

### Requirement: Pagination is accurate bounded and explicitly live
Ranking requests SHALL use integer limits from 1 to 100, default 20, and non-negative integer offsets no greater than 10,000. Totals SHALL describe the complete filtered population. Review ordering SHALL use score and a unique native-identity tie-breaker. Game ordering SHALL use score descending, external critic review count descending, first release date descending with unknown dates last, and native ID ascending as the final unique tie-breaker. Pages SHALL have documented live-list semantics rather than promising a frozen traversal across score refreshes.

#### Scenario: Page exceeds available results
- **WHEN** a valid requested page lies beyond the filtered population
- **THEN** items are empty while totals remain accurate and hasNextPage is false

#### Scenario: Scores refresh during navigation
- **WHEN** engagement changes between two page requests
- **THEN** the response identifies its calculation time and the client can refresh the live ranking
- **AND** the API does not claim snapshot-consistent pagination

#### Scenario: Games tie on score
- **WHEN** two eligible games have the same score and different critic review counts
- **THEN** the game with more critic reviews ranks first regardless of their native IDs

#### Scenario: Games tie on score and critic count
- **WHEN** two eligible games have the same score and critic review count but different release dates
- **THEN** the more recently released game ranks first

#### Scenario: Games tie on every ranking value
- **WHEN** two eligible games share score, critic review count, and release date
- **THEN** the lower native ID ranks first on every request, so consecutive pages neither repeat nor skip either game
