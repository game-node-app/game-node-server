# Spec Delta

## ADDED Requirements

### Requirement: Delta change polling
The system SHALL poll IGDB at a fixed interval for each tracked stream, reading entries whose `updated_at` falls within a bounded window that starts at the stream's durable watermark minus a fixed overlap and ends a fixed lag before the current time. A window SHALL be fixed for the whole pass, paged in ascending ID order, and the watermark SHALL advance to the window end only after every entry in the window has been applied.

#### Scenario: Game changed on IGDB
- **WHEN** a game's IGDB `updated_at` falls after the games stream's watermark
- **THEN** a later delta pass imports the game's current data without waiting for a sweep

#### Scenario: Previously hidden game becomes visible
- **WHEN** a game that a sweep could not see later appears in IGDB with a newer `updated_at`
- **THEN** the next delta pass creates it locally

#### Scenario: Interrupted pass
- **WHEN** the process stops partway through a delta window
- **THEN** the next pass resumes the same window after its last committed ID and the watermark has not moved

#### Scenario: Entry updated during a pass
- **WHEN** an entry changes again after its window was fixed
- **THEN** it is picked up by a later window and replaying it is idempotent

#### Scenario: Persistent non-skippable failure in a stream
- **WHEN** an entry fails required persistence with an error that is not eligible for a per-game skip
- **THEN** that stream's watermark stays unchanged, the failure is recorded with stream, ID and stage, and the stream is retried after the pause cooldown while other streams continue

### Requirement: Delta change routing
Delta entries SHALL be applied by kind. Changed games SHALL be imported. Changed game-owned children that have their own timestamp (involved companies, external games, game localizations) SHALL import their parent game. Changed shared entities (companies, platforms, genres, themes, keywords, franchises, game engines, game modes, player perspectives) SHALL update only that entity's stored row.

#### Scenario: External game changes without a game timestamp change
- **WHEN** an IGDB external game is updated and its parent game's `updated_at` is unchanged
- **THEN** the parent game is re-imported and the stored external game reflects the change

#### Scenario: Shared company renamed
- **WHEN** an IGDB company's `updated_at` advances
- **THEN** the stored company row is updated and no game linked to it is re-imported for that reason

#### Scenario: Shared entity not stored locally
- **WHEN** a changed shared entity has no local row
- **THEN** it is not inserted by the standalone shared-entity delta, and it is created when a referencing game is imported

#### Scenario: Non-transient database rejection for one game
- **WHEN** the database rejects one game's import with a non-transient TypeORM `QueryFailedError`, including `ER_DUP_ENTRY`
- **THEN** its transaction is rolled back, the game is skipped with a `catalog.game.skipped` warning containing its ID, reason and database code, and the delta stream or sweep advances
- **AND** a later delta change or sweep retries the skipped game

### Requirement: Delta progress seeding
When a stream has no durable watermark, the system SHALL seed it from the `startedAt` of the most recent catalog run, completed or in progress; if it is null, the system SHALL use the current time minus the configured sweep interval (`now − intervalDays`).

#### Scenario: First deployment after a completed scan
- **WHEN** delta polling starts for the first time and the last completed run started at time T
- **THEN** every stream's first window starts at T minus the overlap

#### Scenario: Sweep in progress
- **WHEN** a stream has no durable watermark and a catalog sweep is in progress
- **THEN** its first window starts at that sweep's `startedAt` minus the overlap

### Requirement: Checksum sweep comparison
A scheduled catalog run SHALL sweep each tracked IGDB endpoint in ascending ID order, comparing `id`, `checksum`, ownership IDs and each endpoint's declared compared fields against local values. Only missing rows, changed checksums or differing compared fields SHALL trigger refreshes through the delta routing.

#### Scenario: In-place cover edit
- **WHEN** an IGDB cover keeps its ID but its checksum differs from the stored cover
- **THEN** the sweep re-imports the cover's parent game

#### Scenario: Game missing locally
- **WHEN** the sweep sees an IGDB game ID that has no local row
- **THEN** the game is imported

#### Scenario: Nothing changed
- **WHEN** every entry on a sweep page matches its stored checksum and all compared fields match
- **THEN** no expanded fetch or game write is made for that page

#### Scenario: Newly stored source field on existing rows
- **WHEN** the importer starts storing a source field declared as compared on an endpoint, and existing rows have unchanged IGDB checksums
- **THEN** the next ordinary sweep refreshes each row whose stored value differs from the source
- **AND** no separate backfill job, command or watermark reset is needed

#### Scenario: Compared field references a row absent locally
- **WHEN** a compared source value references a row that is not stored locally
- **THEN** it does not count as a difference and triggers no refresh

#### Scenario: Company logo has no local company
- **WHEN** a company logo sweep entry is not referenced by any locally stored company
- **THEN** no orphan logo row is inserted

#### Scenario: Entry belongs to a game IGDB does not return
- **WHEN** a mismatched child's parent game is not returned by IGDB
- **THEN** the refresh is a logged no-op, nothing is deleted, and the sweep continues

#### Scenario: Non-IGDB external game rows
- **WHEN** local external game rows originate from a source other than IGDB
- **THEN** the sweep neither compares nor modifies them

### Requirement: Refresh relationship reconciliation
Every game import started by a delta pass or sweep SHALL reconcile all supported relationships, comparing each relationship by checksum, even when the game's own checksum already matches.

#### Scenario: Child changed, game checksum unchanged
- **WHEN** a refresh imports a game whose checksum matches the stored game but whose localization checksum differs
- **THEN** the stored localization is updated

#### Scenario: Nothing changed
- **WHEN** a refresh imports a game whose game and relationship checksums all match
- **THEN** no relationship rows are written

### Requirement: Source-recency guard
The system SHALL store each game's own IGDB `updated_at`. A game import SHALL make no writes when its incoming source timestamp is older than the stored value. Equal or newer values and games with no stored value SHALL be imported normally.

#### Scenario: Stale data arrives after fresh data
- **WHEN** a game import carries an IGDB `updated_at` older than the one already stored for that game
- **THEN** no game or relationship writes are made and the skip is logged

#### Scenario: Child-only change
- **WHEN** a game import carries the same IGDB `updated_at` as stored but a changed child
- **THEN** the import proceeds and the child is updated

#### Scenario: Legacy row without a stored timestamp
- **WHEN** a stored game has no IGDB `updated_at`
- **THEN** the import proceeds and records the incoming value

### Requirement: Delta operational visibility
The system SHALL report, for each delta stream, its watermark, the current window, entries applied, duration, and actionable failures, without logging full payloads or credentials.

#### Scenario: Operator checks freshness
- **WHEN** a delta pass finishes or a stream pauses
- **THEN** structured output identifies the stream, its watermark lag behind the current time, counts and any failure stage

## MODIFIED Requirements

### Requirement: Internal catalog fetching
The system SHALL automatically fetch catalog changes directly from IGDB using configured credentials, through delta polling and scheduled checksum sweeps, preserving the existing importer’s game metadata and relationships. The system SHALL NOT expose a legacy payload ingestion endpoint, per-game legacy queue worker, or webhook receiver.

#### Scenario: Automatic eligible run
- **WHEN** the application starts with the state tables migrated and an idle or eligible completed run
- **THEN** the system sweeps the catalog and persists the entries and supported relationships that differ
- **AND** no enable flag or legacy-queue drain check is required

#### Scenario: Former push endpoint
- **WHEN** a producer submits a payload to the former `/v1/sync/igdb` route
- **THEN** no game payload is accepted or queued

#### Scenario: Invalid source response
- **WHEN** IGDB returns a non-success response or a malformed response body
- **THEN** the system records a fetch failure and does not interpret that response as an empty final page or empty delta window

### Requirement: Strict batch backpressure
The system SHALL hold at most one source page at a time for each active sweep run and each delta stream pass. It SHALL NOT fetch the next page until every game and entity refreshed from the current page has completed its required persistence and the page checkpoint is durable. Required persistence SHALL include imported-game statistics initialization.

#### Scenario: Slow processing
- **WHEN** one game or its statistics initialization remains unfinished for the current page
- **THEN** no request for the next sweep page or delta page is made

#### Scenario: Failed checkpoint persistence
- **WHEN** all refreshes finish but the page checkpoint cannot be persisted
- **THEN** the system does not fetch the next page and recovers from the last durable checkpoint

### Requirement: Configurable processing bounds
The system SHALL default to a batch size of 25 for expanded game fetches, one concurrent game, and at most two concurrent relationship operations. Configured limits SHALL apply across each active sweep run and delta pass, SHALL be validated before execution, and SHALL NOT grow with total catalog size.

#### Scenario: Defaults on a large catalog
- **WHEN** a sweep or delta pass refreshes many games with default configuration
- **THEN** each expanded fetch contains at most 25 games and processing respects both concurrency limits regardless of catalog size

#### Scenario: Invalid configuration
- **WHEN** the importer has non-positive, non-integer, or out-of-range processing limits
- **THEN** startup rejects the invalid configuration with an actionable error

### Requirement: Durable ordered progress
The system SHALL persist non-expiring sweep progress, as the current endpoint and cursor, only after a complete page succeeds. Each endpoint SHALL be traversed in explicit ascending ID order, and recovery SHALL resume from the last committed endpoint and cursor after interruption. A completed sweep SHALL NOT delete local rows merely because they were absent from a response.

#### Scenario: Restart during a page
- **WHEN** the process stops after some refreshes have committed but before their page checkpoint commits
- **THEN** recovery starts after the previous committed cursor of the same endpoint and safely replays the unfinished page without skipping IDs

#### Scenario: End of scan
- **WHEN** a valid empty response is received after the committed cursor of an endpoint
- **THEN** the sweep moves to the next endpoint from the beginning, or is marked completed after the last endpoint, and a later sweep starts from the first endpoint

### Requirement: Exclusive run ownership
The system SHALL allow only one active sweep run and only one active delta poller across replicas and duplicate triggers. Ownership loss SHALL prevent further fetching and checkpoint or watermark advancement by the previous owner, and expired ownership SHALL permit safe recovery of unfinished work.

#### Scenario: Two replicas trigger simultaneously
- **WHEN** two replicas attempt to start or recover a sweep, or to start a delta pass
- **THEN** only one owns that work and the other does not fetch its pages

#### Scenario: Old owner resumes after takeover
- **WHEN** an expired sweep or delta owner resumes after another worker acquires that work
- **THEN** the expired owner cannot advance the cursor or watermark or start further processing

#### Scenario: Sweep and delta overlap
- **WHEN** a sweep and a delta pass refresh the same game concurrently
- **THEN** their writes are serialized and the source-recency guard prevents the older source data from replacing the newer

### Requirement: Weekly scheduling and overlap handling
The system SHALL default to a seven-day sweep interval and SHALL support a fourteen-day interval. An active sweep SHALL resume rather than start over after restart, and triggers SHALL NOT accumulate overlapping runs. After successful completion, the next sweep SHALL become due after the configured interval. Delta polling SHALL run independently of the sweep schedule.

#### Scenario: Weekly default
- **WHEN** an eligible importer has completed a sweep and no interval override is configured
- **THEN** its next sweep becomes eligible seven days after completion

#### Scenario: Every-two-weeks configuration
- **WHEN** the sweep interval is configured to fourteen days
- **THEN** its next sweep becomes eligible fourteen days after completion

#### Scenario: Trigger during unfinished work
- **WHEN** a trigger arrives while a sweep is active or paused
- **THEN** no new sweep or repeated queued schedule backlog is created

#### Scenario: Delta during a sweep pause
- **WHEN** the sweep is paused or waiting for its next interval
- **THEN** delta passes continue on their own interval

## REMOVED Requirements

### Requirement: Periodic relationship reconciliation
**Reason**: Epoch-bucket reconciliation of unchanged games existed only because the full scan could not tell which relationships had changed. The checksum sweep compares every stored relationship row directly, and refreshes always reconcile relationships by checksum.
**Migration**: Remove `IGDB_SYNC_RECONCILE_EVERY_RUNS` and `IGDB_SYNC_SKIP_RELATIONS_ON_CHECKSUM_MATCH` from deployments. To force a full relationship rewrite, use the existing first-run forced reconciliation.
