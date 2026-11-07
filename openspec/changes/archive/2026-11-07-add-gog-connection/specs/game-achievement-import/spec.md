# Spec Delta

## ADDED Requirements

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
