# IGDB Catalog Sync

## Purpose

Refresh the game catalog from IGDB with bounded resource consumption, durable recovery, and safe persistence so background imports can coexist with the API without a catalog-sized queue backlog.

## ADDED Requirements

### Requirement: Internal catalog fetching
When internal synchronization is enabled, the system SHALL fetch the catalog directly from IGDB using configured credentials and SHALL preserve the game metadata and relationships supported by the existing importer.

#### Scenario: Import without the external producer
- **WHEN** a catalog run starts with valid credentials and no external Python producer running
- **THEN** the system fetches and persists catalog entries and their supported relationships directly

#### Scenario: Invalid source response
- **WHEN** IGDB returns a non-success response or a malformed response body
- **THEN** the system records a fetch failure and does not interpret that response as an empty final page

### Requirement: Strict batch backpressure
The system SHALL fetch at most one catalog page at a time and SHALL NOT fetch the next page until every game in the current page has completed its required persistence and the batch checkpoint is durable. Required persistence SHALL include imported-game statistics initialization.

#### Scenario: Slow processing
- **WHEN** one game or its statistics initialization remains unfinished in the current page
- **THEN** no request for the next catalog page is made

#### Scenario: Failed checkpoint persistence
- **WHEN** all games finish but the batch checkpoint cannot be persisted
- **THEN** the system does not fetch the next page and recovers from the last durable checkpoint

### Requirement: Configurable processing bounds
The system SHALL default to a batch size of 25, one concurrent game, and at most two concurrent relationship operations. Configured limits SHALL apply across the active catalog run, SHALL be validated before execution, and SHALL NOT grow with total catalog size.

#### Scenario: Defaults on a large catalog
- **WHEN** a full catalog run uses default configuration
- **THEN** each page contains at most 25 games and processing respects both concurrency limits regardless of catalog size

#### Scenario: Invalid configuration
- **WHEN** an enabled importer has non-positive, non-integer, or out-of-range processing limits
- **THEN** startup rejects the invalid configuration with an actionable error

### Requirement: Bounded queue storage
Catalog orchestration SHALL queue compact identifiers rather than expanded game payloads. Pending orchestration jobs and retained job history SHALL be bounded independently of the number of imported games. Importing games SHALL NOT create an accumulating statistics-job backlog.

#### Scenario: Catalog continues growing
- **WHEN** a run processes additional pages
- **THEN** it does not accumulate queued full-game payloads, page history, or asynchronous statistics initialization jobs

### Requirement: Durable ordered progress
The system SHALL persist non-expiring progress only after a complete batch succeeds, traverse a full scan in explicit ascending game-ID order, and resume from the last committed cursor after interruption. A completed scan SHALL NOT delete local games merely because they were absent from a response.

#### Scenario: Restart during a page
- **WHEN** the process stops after some games have committed but before their batch checkpoint commits
- **THEN** recovery starts after the previous committed cursor and safely replays unfinished-page entries without skipping IDs

#### Scenario: End of scan
- **WHEN** a valid empty response is received after the committed cursor
- **THEN** the run is marked completed and a later full scan starts from the beginning

### Requirement: Exclusive run ownership
The system SHALL allow only one active catalog run across replicas and duplicate triggers. Ownership loss SHALL prevent further fetching and checkpoint advancement by the previous owner, and expired ownership SHALL permit safe recovery of unfinished work.

#### Scenario: Two replicas trigger simultaneously
- **WHEN** two replicas attempt to start or recover synchronization
- **THEN** only one owns the run and the other does not fetch catalog pages

#### Scenario: Old owner resumes after takeover
- **WHEN** an expired owner resumes after another worker acquires the run
- **THEN** the expired owner cannot advance the cursor or start further catalog processing

### Requirement: Weekly scheduling and overlap handling
The system SHALL default to a seven-day refresh interval and SHALL support a fourteen-day interval. An active run SHALL resume rather than start over after restart; triggers SHALL NOT accumulate overlapping runs. After successful completion, the next run SHALL become due after the configured interval.

#### Scenario: Weekly default
- **WHEN** an enabled importer has completed a run and no interval override is configured
- **THEN** its next full scan becomes eligible seven days after completion

#### Scenario: Every-two-weeks configuration
- **WHEN** the refresh interval is configured to fourteen days
- **THEN** its next full scan becomes eligible fourteen days after completion

#### Scenario: Trigger during unfinished work
- **WHEN** a trigger arrives while a run is active or paused
- **THEN** no new catalog run or repeated queued schedule backlog is created

### Requirement: Bounded retries and explicit pause
The system SHALL retry transient source, persistence, and orchestration failures with bounded attempts and backoff. An exhausted or non-retryable failure SHALL pause progress with an actionable error and unchanged batch cursor. Paused work SHALL require an explicit operator resume after correction.

#### Scenario: Transient source failure
- **WHEN** IGDB rate-limits a fetch or temporarily fails
- **THEN** the system backs off without advancing progress and retries within its configured attempt budget

#### Scenario: Persistent game failure
- **WHEN** a game repeatedly fails required persistence
- **THEN** the run pauses with its game ID, failure stage, and committed cursor available to the operator

#### Scenario: Resume paused work
- **WHEN** an operator explicitly resumes a corrected paused run
- **THEN** the system retries from its existing committed cursor instead of starting a new full scan

### Requirement: Replay-safe game persistence
Reprocessing a game SHALL repair incomplete required relationships even if its base checksum already matches. A failed game write SHALL NOT be mistaken for a completed import. Invalid entries SHALL fail before persistence and SHALL NOT be silently checkpointed past.

#### Scenario: Relationships fail after base write
- **WHEN** a game is retried following a failure after its base row was written
- **THEN** required relationships are repaired and completion is recorded only after all required writes succeed

#### Scenario: Duplicate processing
- **WHEN** a committed game is replayed after a crash
- **THEN** it does not create duplicate associations or reset existing statistics counters

#### Scenario: Link to a game beyond the current page
- **WHEN** a valid game references a game not yet present locally, including an ID above the scan boundary
- **THEN** the same game transaction inserts a minimal referenced-game row if absent, initializes its statistics, and persists the link without fetching another page
- **AND** the reference insert does not overwrite existing metadata/counters, assign a completed-import checksum, or advance committed cursor/counts
- **AND** failure rolls back the reference row, statistics and link together; replay is idempotent and a later full import hydrates the referenced game

#### Scenario: Invalid game
- **WHEN** a fetched entry fails required identity or name validation
- **THEN** no writes are made for that entry and the batch enters the failure policy without cursor advancement

### Requirement: Periodic relationship reconciliation
Full catalog scans SHALL retain periodic reconciliation of supported relationships even for unchanged game checksums. Recovery of interrupted work SHALL NOT be skipped by the normal checksum optimization.

#### Scenario: Unchanged game needs reconciliation
- **WHEN** an unchanged game is eligible under the existing periodic reconciliation policy
- **THEN** its supported relationships are reconciled during the full scan

### Requirement: Controlled producer cutover
The system SHALL provide mutually exclusive internal and legacy ingestion modes. In internal mode, the authenticated legacy push endpoint SHALL return HTTP 409 without queuing supplied games. Internal fetching SHALL wait until existing legacy IGDB jobs are drained.

#### Scenario: Old producer remains running
- **WHEN** an authenticated producer submits a payload to the legacy endpoint in internal mode
- **THEN** the endpoint returns HTTP 409 and adds no game jobs

#### Scenario: Legacy jobs remain during activation
- **WHEN** internal synchronization is enabled while legacy jobs remain waiting, active, or delayed
- **THEN** internal fetching remains blocked until that work is drained

#### Scenario: Legacy rollback
- **WHEN** internal mode is disabled after its worker has stopped
- **THEN** the existing authenticated payload ingestion behavior remains available

### Requirement: Operational visibility and local resource validation
The system SHALL report run state, committed cursor, batch duration, progress counts, and actionable failures without logging full game payloads or credentials. A repeatable local check SHALL verify processing and queue bounds with generated fixtures and disposable services, without remote infrastructure or live IGDB credentials.

#### Scenario: Operator checks progress
- **WHEN** a batch finishes or a run pauses
- **THEN** structured operational output identifies the run, progress, duration, and any failure stage

#### Scenario: Local boundedness check
- **WHEN** the local check runs generated catalogs of different sizes against a stub IGDB source and disposable database/queue services
- **THEN** it asserts one live page, configured processing limits, identifier-only queue payloads, bounded job retention, and no imported-game statistics backlog
- **AND** it reports importer memory, Redis memory, and elapsed time as diagnostics rather than evidence of production capacity

#### Scenario: Verification without remote infrastructure
- **WHEN** a developer follows the documented verification commands on a local machine with Docker and Node.js
- **THEN** tests run without provisioning or accessing a remote server, supplying production credentials, or importing a live catalog
