# Game Achievement Import Specification

## Purpose

Imports obtained game achievements and completion state with selective provider access, complete initial coverage, periodic reconciliation, and recoverable activity generation.

## Requirements

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

#### Scenario: Concurrent Steam catalogue consumers on a cold cache
- **WHEN** obtained-achievement validation and completion request the same Steam schema during one execution
- **THEN** they share one in-flight schema fetch, including when the provider cache is cold
- **AND** a failed fetch remains retryable and is not stored as a successful snapshot

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

### Requirement: GOG achievement definitions and obtained results
The system SHALL expose GOG achievement definitions and import obtained achievements through existing game-achievement APIs and synchronization. Definitions and unlocks SHALL use the same stable GOG achievement identity within category `Gog`. Only verified unlock dates SHALL mark achievements obtained. GOG data SHALL NOT be attached to a game's Steam, Xbox or PSN achievement set.

#### Scenario: GOG definition and unlock
- **WHEN** GOG reports a definition with a stable ID and a valid unlock date for the connected account
- **THEN** its definition and obtained result share that ID and external-game mapping, with GOG source, PC platform, provider title, description and icon

#### Scenario: Locked GOG achievement
- **WHEN** a complete snapshot contains a definition whose unlock date is null
- **THEN** it contributes to the catalogue without creating an obtained row

#### Scenario: Malformed unlock date
- **WHEN** a non-null unlock date cannot be validated
- **THEN** the snapshot fails as incomplete without guessing an unlock date or changing completion

### Requirement: Preserve GOG achievement text
Definitions SHALL return the provider's name and description unchanged regardless of `visible`, in both catalogue reads and synchronization.

#### Scenario: Hidden GOG achievement text
- **WHEN** GOG returns a definition with `visible: false` and a name and description
- **THEN** catalogue reads and synchronization return that name and description unchanged, without masking or replacing them

### Requirement: Complete and isolated GOG achievement snapshots
GOG achievement synchronization SHALL retrieve all pages and derive definitions, unlocks and completion from one account-specific snapshot. User progress SHALL NOT leak into shared catalogue responses or another user's synchronization. Missing authentication, malformed or truncated responses and ambiguous errors SHALL NOT be treated as no achievements. Definitive no-achievement results SHALL follow existing empty or unsupported handling.

#### Scenario: Multi-page achievement set
- **WHEN** a GOG achievement response indicates more pages or more records than received
- **THEN** the missing pages are retrieved before committing results, or the snapshot fails as incomplete if completion cannot be established

#### Scenario: Shared catalogue response
- **WHEN** a catalogue lookup uses a connected GOG account to retrieve definitions
- **THEN** the response contains only catalogue fields and exposes no account identity, credentials or unlock dates

#### Scenario: Two connected users
- **WHEN** two users synchronize the same GOG game with different unlocked achievements
- **THEN** each import uses that user's account-specific snapshot and neither receives the other's obtained rows

#### Scenario: No catalogue credentials
- **WHEN** no usable connected GOG account is available for a catalogue lookup
- **THEN** the lookup reports unavailable without storing an empty catalogue as success

#### Scenario: Valid empty or unsupported set
- **WHEN** a complete valid response confirms zero achievements or a verified provider response confirms the game has no achievement support
- **THEN** the per-game result is recorded as empty or unsupported without deleting prior obtained rows

### Requirement: GOG achievement scheduling and completion
GOG games SHALL enter the existing per-game synchronization lifecycle for initial coverage, meaningful activity changes, retries and periodic reconciliation. Eligibility SHALL NOT depend on positive playtime. New obtained rows, completion and activities SHALL retain existing atomicity, ownership and deduplication behavior. GOG SHALL NOT invent a platinum trophy.

#### Scenario: Zero playtime with achievements
- **WHEN** an owned mapped GOG game has no recorded playtime and has never had an achievement check
- **THEN** it remains eligible for an initial achievement refresh

#### Scenario: New unlock without new playtime
- **WHEN** a GOG unlock appears after playtime stopped changing
- **THEN** periodic reconciliation can import it within the existing seven-day reconciliation policy

#### Scenario: Repeated completed snapshot
- **WHEN** synchronization confirms the same completed GOG set again
- **THEN** obtained rows and activities are not duplicated and the original completion timestamp remains intact

#### Scenario: Account changes while queued
- **WHEN** the connection is deleted, replaced or reconnected to another account before a queued GOG job commits
- **THEN** the stale job cannot write results for the previous account
