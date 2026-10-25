# Spec Delta

## Purpose

Discovers importable library entries and applies optional automatic collection imports with recoverable status transitions and deduplicated notifications.

## ADDED Requirements

### Requirement: Empty discovery is normal success
Discovery SHALL treat a complete scan with no new importable games as a successful empty result without transient retries. Existing HTTP response conventions SHALL be preserved through an explicit compatibility boundary where necessary.

#### Scenario: Fully processed library
- **WHEN** every discovered game is already processed or ignored
- **THEN** background discovery completes normally without retrying a no-new-games error

### Requirement: Reuse complete library results
Due discovery and playtime work for the same account SHALL reuse an available complete library snapshot within the same execution where possible, while retaining independent success and failure outcomes.

#### Scenario: Playtime persistence fails after discovery succeeds
- **WHEN** discovery completes from a valid shared snapshot but playtime persistence fails
- **THEN** discovery retains its successful outcome and playtime remains independently retryable

### Requirement: Idempotent automatic import transitions
Automatic import SHALL preserve user collection preferences, ignored status, and ownership validation. A retry SHALL finish missing processed-state transitions for already-created library entries without duplicating entries or resetting user-maintained collection data.

#### Scenario: Failure after collection creation
- **WHEN** a collection entry exists from an earlier attempt but its processed transition did not complete
- **THEN** retry completes the missing transition without adding another entry or overwriting user changes

#### Scenario: Invalid destination collection
- **WHEN** an automatic-import destination no longer belongs to the user or no longer exists
- **THEN** processing follows validated fallback or explicit failure behavior without writing into another user's collection

### Requirement: Notification state does not suppress failed imports
The system SHALL track notification delivery separately from successful automatic import. A notified game whose import failed SHALL remain eligible for recovery, while successful imports and notifications SHALL be deduplicated across retries.

#### Scenario: Mixed automatic-import outcomes
- **WHEN** some discovered games import successfully and others fail
- **THEN** committed results are reported accurately and failed items remain retryable even if discovery was already notified

#### Scenario: Notification enqueue fails
- **WHEN** automatic import commits but notification publication fails
- **THEN** publication can retry without reimporting successful games or duplicating the final notification

### Requirement: Conservative legacy recovery
Migration SHALL NOT automatically replay all historical notifications or import all previously notified entries. Legacy recovery SHALL be bounded and preserve processed and ignored decisions.

#### Scenario: Previously notified historical library
- **WHEN** retry-safe discovery is deployed to an account with historical notification records
- **THEN** prior notifications are not mass-republished and previously ignored games remain ignored
