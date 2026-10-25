# Spec Delta

## Purpose

Maintains consistent observed cumulative playtime and honest period estimates while avoiding redundant database work and polling-dependent session statistics.

## ADDED Requirements

### Requirement: Atomic cumulative observations
The system SHALL persist a changed playtime observation and its current aggregate consistently, distinguish observation time from provider played dates, and avoid duplicate history observations when identical work is retried.

#### Scenario: Current-row update fails
- **WHEN** persistence fails between preparing a history observation and updating the current playtime row
- **THEN** the attempt leaves no committed partial pair and a retry does not duplicate the observation

#### Scenario: Identical successful observations
- **WHEN** the same unchanged cumulative values are observed repeatedly
- **THEN** no redundant changed-history entry is created

### Requirement: Period estimates include a baseline
Period playtime SHALL use the latest trusted observation at or before the period start and non-negative increments through its end. An increment SHALL be attributed to its ending observation for existing period responses and documented as an estimate; a first-ever cumulative sample SHALL NOT be invented as historical playtime.

#### Scenario: One observation inside the period
- **WHEN** the baseline is 100 seconds before the period and one later observation is 160 seconds inside it
- **THEN** the period contains an estimated 60 seconds rather than zero

#### Scenario: First-ever lifetime sample
- **WHEN** the first known observation reports 160 lifetime seconds without a trusted prior baseline
- **THEN** that sample establishes a baseline without asserting that all 160 seconds were played during the period

#### Scenario: Provider cumulative correction
- **WHEN** cumulative totals change from 100 to 80 and later to 90
- **THEN** the correction starts a new baseline and subsequent growth contributes 10 seconds without a negative or inflated period value

### Requirement: Rolling totals expire without new play
The system SHALL recalculate derived recent playtime as the observation window advances, even when cumulative provider values are unchanged. Provider-supplied recent totals SHALL retain their documented platform semantics.

#### Scenario: Last observed play leaves the recent window
- **WHEN** a game's last counted increment falls outside the rolling 14-day window and no new play is observed
- **THEN** its derived recent playtime expires rather than remaining frozen behind an unchanged checksum

#### Scenario: Old checksum match
- **WHEN** unchanged current values were last checked more than 14 days ago
- **THEN** the record is not incorrectly classified as updated within the last 14 days

#### Scenario: Xbox statistics are absent for an existing game
- **WHEN** a complete Xbox library still contains a mapped game but its MinutesPlayed statistics are missing or have no value
- **THEN** existing cumulative totals, played dates, and play count are preserved while derived recent time is recalculated
- **AND** absent statistics create neither an invented zero cumulative total nor a new history observation

### Requirement: Polling-independent play counts
The system SHALL preserve authoritative provider play counts and SHALL NOT infer new sessions solely from cumulative changes detected by polling. Existing inferred counts SHALL remain preserved unless an authoritative replacement is available.

#### Scenario: Same playtime with different refresh frequencies
- **WHEN** otherwise identical Steam or Xbox histories are refreshed once or four times per day
- **THEN** refresh count does not increase totalPlayCount

#### Scenario: Authoritative PSN count
- **WHEN** PSN provides a valid play count
- **THEN** the imported value is preserved independently of scheduler cadence

### Requirement: Bounded local reads per refresh
The system SHALL batch existing playtime lookups and reuse one consistent period window for derived recent calculations, without performing a full-user history aggregation separately for every game.

#### Scenario: Multi-game PSN or Xbox import
- **WHEN** a connection refresh imports many games for the same source and platform
- **THEN** existing state and recent-period aggregates are retrieved in bounded batches and reused across the games

### Requirement: Preserve legacy history and manual validation
The system SHALL preserve existing history rows and enforce validation of manually submitted playtime. It SHALL disclose the precision limits of legacy observations and SHALL NOT manufacture missing sessions or exact dates during migration.

#### Scenario: Migration of legacy inferred history
- **WHEN** existing observations lack reliable observation timestamps
- **THEN** migration preserves their data and documents the estimation limit rather than rewriting them into invented exact sessions

### Requirement: Validated manual submissions
Manual HTTP submissions SHALL require positive safe-integer game/platform IDs, a supported UserPlaytimeSource value, and integer seconds from 0 through 2,147,483,647. Played dates MAY be absent or null; supplied dates SHALL be valid. The persisted user identity SHALL come from the authenticated session.

#### Scenario: Manual submission
- **WHEN** a user submits invalid playtime through an existing manual endpoint
- **THEN** the endpoint rejects the request with HTTP 400 before persistence, while unauthenticated submissions remain unauthorized


#### Scenario: Optional date and authenticated ownership
- **WHEN** an authenticated user submits valid playtime with an absent or null played date and includes another user identity in the body
- **THEN** persistence accepts the date and uses only the authenticated session identity
