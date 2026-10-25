# Spec Delta

## Purpose

Coordinates reliable and resource-bounded refreshes of linked gaming accounts while exposing data freshness and preserving progress across failures and restarts.

## ADDED Requirements

### Requirement: Daily full refresh eligibility
The system SHALL admit automatic and manual full refreshes through the same persistent per-connection policy, with a default interval of 24 hours after successful refresh. Due work SHALL be discovered and processed in bounded batches.

#### Scenario: Manual refresh during cooldown
- **WHEN** a user requests a full refresh before the connection is eligible
- **THEN** no duplicate full scan starts and the caller receives the pending or next-eligible status

#### Scenario: Restart and multiple application instances
- **WHEN** application instances restart or concurrently discover the same eligible connection
- **THEN** at most one current full-refresh attempt is admitted and persisted eligibility is preserved

#### Scenario: Large existing account population
- **WHEN** daily scheduling is initialized for existing connections
- **THEN** initial eligibility is spread across the day and discovery does not load the complete user population

#### Scenario: Xbox reaches the bounded service cap
- **WHEN** Xbox returns a structurally valid title list at or above 5,000 items, or signals more provider titles than the service requests
- **THEN** the stage completes under the service's 5,000-title bound and advances normal success timestamps without requesting an unverified next page

### Requirement: Immediate and identity-safe onboarding
The system SHALL admit the initial refresh of a newly linked source account immediately, invalidate account-bound state after source-account replacement, and reject writes from work whose connection identity is no longer current.

#### Scenario: Connection settings update
- **WHEN** only automatic-import settings change for an existing source account
- **THEN** daily cooldown and successful synchronization state are preserved

#### Scenario: Old job after replacement or deletion
- **WHEN** a pending job belongs to a disconnected or replaced source account
- **THEN** it terminates without applying old results to the current account

### Requirement: Recoverable admission and queue lifecycle
The system SHALL bound retained job history, allow recurring work after earlier completion, await admission writes, and recover abandoned admissions. Retaining completed jobs SHALL NOT permanently suppress future valid refreshes.

#### Scenario: Consecutive daily imports
- **WHEN** a connection becomes eligible after an earlier successful import
- **THEN** a new job can run regardless of retained diagnostic history

#### Scenario: Enqueue failure or process death
- **WHEN** admission succeeds but enqueue fails or the admitting process exits
- **THEN** the caller does not receive false success and an expired reservation cannot indefinitely block later work

#### Scenario: Competing or expired workers
- **WHEN** a previous admission owner finishes after a newer attempt takes ownership
- **THEN** the previous owner cannot overwrite the newer attempt's state

### Requirement: Controlled refresh from read requests
Achievement and journal reads SHALL return persisted obtained results and SHALL route any requested refresh through shared per-game admission. Successful targeted achievement refreshes SHALL have a default 24-hour cooldown shared with full-refresh results.

#### Scenario: Repeated reads of stale data
- **WHEN** concurrent requests read stale achievements for the same user and external game
- **THEN** persisted results remain readable and at most one eligible background refresh is pending or active

#### Scenario: First read before import completion
- **WHEN** a game has no persisted achievements and no successful synchronization yet
- **THEN** freshness status distinguishes pending or unknown data from a successful empty result

### Requirement: Bounded provider pressure and failure recovery
The system SHALL bound cancellable request duration and attempt progression between calls and before persistence, share observable provider throttling cooldowns, respect exposed Retry-After, and retry transient failures without claiming success. Permanent unsupported outcomes SHALL NOT consume repeated transient retries.

#### Scenario: Provider throttles one worker
- **WHEN** the installed client exposes a throttling response with a retry delay
- **THEN** other workers using the same provider context respect the applicable cooldown and existing data remains available

#### Scenario: Provider request never completes
- **WHEN** a cancellable provider request or connection attempt exceeds its configured deadline
- **THEN** processing terminates with a visible retryable failure and admission can recover

### Requirement: Retain the PSN client within its transport limits
The system SHALL retain `psn-api`. PSN in-flight cancellation, hard request/attempt duration bounds, and hidden HTTP status/header/Retry-After preservation are excluded. Ambiguous PSN transport outcomes SHALL remain failed/incomplete, and late results SHALL pass ownership/deadline checks before persistence.

#### Scenario: Retained PSN request outlives a deadline
- **WHEN** an in-flight PSN library call outlives the attempt deadline
- **THEN** no network cancellation or immediate transport-resource release is promised, and late results cannot bypass attempt ownership/deadline checks before persistence

### Requirement: Observable freshness and work summaries
The system SHALL expose last successful refresh, current outcome, and next eligibility to authorized callers, and SHALL emit bounded per-run summaries sufficient to compare selected work, provider calls, duration, retries, and queue delay without recording secrets.

#### Scenario: Failed refresh after earlier success
- **WHEN** an account refresh fails after a previous successful refresh
- **THEN** status retains the earlier success timestamp and distinguishes the new failure from fresh data

#### Scenario: Resource comparison
- **WHEN** operators compare equivalent cold and warm synchronization runs
- **THEN** summaries distinguish scheduled jobs from actual provider requests and identify selected versus skipped games
