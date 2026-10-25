# Spec Delta

## Purpose

Imports obtained game achievements and completion state with selective provider access, complete initial coverage, periodic reconciliation, and recoverable activity generation.

## ADDED Requirements

### Requirement: Explicit per-game synchronization success
The system SHALL track successful synchronization independently of obtained-achievement rows, including successful empty and unsupported outcomes, and SHALL scope this state to the current source account and external game.

#### Scenario: Game has zero obtained achievements
- **WHEN** a complete refresh finds zero obtained achievements
- **THEN** the game is recorded as successfully checked and is not repeatedly treated as never synchronized

#### Scenario: Previously failed game
- **WHEN** an earlier refresh failed or returned incomplete data
- **THEN** the game remains eligible for bounded retry without claiming a new success

### Requirement: Selective updates with periodic reconciliation
The system SHALL select games for initial import, meaningful activity/progress changes, due failed work, and reconciliation at least once every seven days after the last successful check. Selection SHALL respect shared freshness admission and SHALL NOT depend only on the presence of obtained rows or playtime statistics.

#### Scenario: Large unchanged library
- **WHEN** a complete daily library snapshot has unchanged inactive games with recent successful achievement checks
- **THEN** those games do not produce new achievement refresh jobs

#### Scenario: Missing timestamp or Xbox playtime statistics
- **WHEN** a game lacks a reliable last-played timestamp or MinutesPlayed value
- **THEN** initial import and periodic achievement reconciliation remain possible

#### Scenario: Delayed achievement synchronization
- **WHEN** a provider reports an achievement after ordinary activity signals stopped changing
- **THEN** periodic reconciliation can discover it without requiring new playtime

### Requirement: Reuse a consistent fetched snapshot
A successful achievement execution SHALL calculate obtained rows, completion, platinum state, and activity contents from the same complete obtained snapshot and required catalogue snapshot without refetching identical data for each calculation.

#### Scenario: Completion and activity need the same catalogue
- **WHEN** a game refresh produces newly obtained achievements
- **THEN** completion and activity use the already fetched catalogue and agree on the imported snapshot

### Requirement: Atomic local achievement results
New obtained rows, completion updates, local activity records, and successful synchronization state SHALL commit consistently. Concurrent attempts SHALL NOT duplicate achievements or activities, and failed attempts SHALL NOT leave a false success marker.

#### Scenario: Failure before activity creation completes
- **WHEN** local processing fails after preparing obtained rows but before the related activity record is complete
- **THEN** no partial local success is committed and a retry can finish the full result

#### Scenario: Concurrent readers and workers
- **WHEN** read-triggered and scheduled refreshes target the same user and external game
- **THEN** one consistent set of obtained rows and corresponding activity records is persisted

### Requirement: Recoverable activity publication
A committed achievement activity SHALL remain eligible for delivery until publication is confirmed. Retrying delivery SHALL NOT recreate obtained rows or duplicate the corresponding feed activity.

#### Scenario: Crash between database commit and queue publication
- **WHEN** the process exits after committing an activity but before publishing it
- **THEN** later processing can publish that activity without requiring another newly obtained achievement

#### Scenario: Publication succeeded but acknowledgement was lost
- **WHEN** an activity is published again after an uncertain acknowledgement
- **THEN** consumers resolve both deliveries to the same feed activity

### Requirement: Stable completion and safe reconciliation
The system SHALL preserve completion state when provider results are incomplete and preserve an existing completion timestamp when recomputing an unchanged completed state. Reconciliation SHALL account for verified mapping or catalogue changes without mass-republishing historical activities.

#### Scenario: Partial trophy snapshot
- **WHEN** one required trophy set fails during refresh
- **THEN** the system does not mark the game incomplete from the partial result

#### Scenario: Unchanged completed game
- **WHEN** reconciliation confirms the same complete achievement set
- **THEN** its original completion timestamp is preserved and no duplicate completion activity is created

### Requirement: No account-specific startup work
Application startup SHALL NOT schedule achievement imports for a hard-coded user or game.

#### Scenario: Repeated application startup
- **WHEN** the application starts repeatedly with no eligible user work
- **THEN** startup alone produces no account-specific achievement job
