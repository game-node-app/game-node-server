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

#### Scenario: Persistent failure in a stream
- **WHEN** an entry in a stream fails required persistence after its attempt budget
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
- **THEN** it is not inserted by the standalone shared-entity delta, and it is created when a referencing game or character is imported

### Requirement: Character catalog persistence
The system SHALL import IGDB characters by source ID, preserving name, slug, URL, aliases, description, country of origin, checksum and source timestamps. It SHALL store optional mug-shot metadata and the current `character_gender` and `character_species` reference records, without relying on deprecated gender/species enums.

#### Scenario: Character with complete details
- **WHEN** IGDB returns a character with aliases, description, country, mug shot, gender and species
- **THEN** the character and referenced details are stored under their IGDB IDs
- **AND** the mug shot retains its image ID, URL, dimensions, animation/transparency flags and checksum

#### Scenario: Optional character details absent
- **WHEN** a valid character has no mug shot, gender, species or descriptive details
- **THEN** it is imported without fabricating values for the absent optional details

### Requirement: Character change routing
The system SHALL track `characters`, `character_genders` and `character_species` as independent timestamped delta streams. Character changes SHALL import the character and its dependencies without refreshing game payloads. Standalone gender/species changes SHALL update only existing lookup rows.

#### Scenario: Character changes independently of its games
- **WHEN** a character's `updated_at` advances but its games' timestamps and checksums do not change
- **THEN** the character is updated without re-importing its games

#### Scenario: Character gender or species renamed
- **WHEN** a stored gender or species lookup changes on IGDB
- **THEN** its stored row is updated without refreshing characters or games

#### Scenario: Referenced lookup missing locally
- **WHEN** an imported character references a gender or species not yet stored locally
- **THEN** that referenced record is created as part of importing the character

### Requirement: Character game associations
The system SHALL store unique many-to-many links between characters and locally stored games. It SHALL retain characters whose games are absent without creating placeholder games. Character refreshes SHALL add missing links even when the character checksum matches and SHALL retain links absent from later IGDB responses.

#### Scenario: Character appears in several games
- **WHEN** a character references multiple locally stored games and its import is replayed
- **THEN** one character row links to each game without duplicate associations

#### Scenario: Referenced game not yet imported
- **WHEN** a character references a game that is absent locally
- **THEN** the character and links to any available games are stored without creating the missing game or an invalid foreign key

#### Scenario: Game imported after its character
- **WHEN** a referenced game becomes available locally after the character was imported
- **THEN** the next character sweep adds its missing association even if the character checksum is unchanged

#### Scenario: Association removed on IGDB
- **WHEN** a later IGDB character response omits a previously linked game
- **THEN** the existing local association is retained under the catalog's no-delete policy

### Requirement: Character relations in game reads
Existing game reads SHALL support explicitly requesting the character relation and its mug-shot, gender and species relations. Characters SHALL NOT be loaded by default solely because character imports are supported.

#### Scenario: Game read requests character details
- **WHEN** a caller requests a game's characters and their nested details through the existing relation-loading interface
- **THEN** the response includes the linked characters and requested stored details

### Requirement: Character coverage through ordinary sweeps
The ordinary scheduled sweep SHALL include `characters`, `character_mug_shots`, `character_genders` and `character_species`. It SHALL traverse all character IDs without an `updated_at` filter, importing missing historical characters. Character streams SHALL use normal delta seeding. The system SHALL NOT add separate backfill jobs, commands, state or historical delta windows.

#### Scenario: Historical character predates delta watermark
- **WHEN** a character is absent locally and its source timestamp is older than the character stream's initial window
- **THEN** the ordinary sweep imports it regardless of its age
- **AND** no separate backfill or watermark reset is needed

#### Scenario: New character stream starts
- **WHEN** the character stream has no durable watermark
- **THEN** it uses the same seeding rule as other streams rather than requesting all historical updates

#### Scenario: Interrupted character sweep
- **WHEN** the process stops before a character page checkpoint commits
- **THEN** the ordinary sweep resumes from its last durable endpoint and cursor and safely replays the unfinished page

### Requirement: Delta progress seeding
When a stream has no durable watermark, the system SHALL seed it from the start time of the most recently completed catalog run, or from the current time minus the configured sweep interval if none exists, so changes since the last full pass are replayed once.

#### Scenario: First deployment after a completed scan
- **WHEN** delta polling starts for the first time and the last completed run started at time T
- **THEN** every stream's first window starts at T minus the overlap

### Requirement: Checksum sweep comparison
A scheduled catalog run SHALL sweep each tracked IGDB endpoint in ascending ID order, comparing `id`, `checksum` and ownership IDs where applicable against local rows. Character pages SHALL also compare `games` with stored links to available games. Only missing or changed rows or missing character-game links SHALL trigger refreshes through the delta routing. Entries whose checksums and required links match SHALL cause no writes.

#### Scenario: In-place cover edit
- **WHEN** an IGDB cover keeps its ID but its checksum differs from the stored cover
- **THEN** the sweep re-imports the cover's parent game

#### Scenario: Game missing locally
- **WHEN** the sweep sees an IGDB game ID that has no local row
- **THEN** the game is imported

#### Scenario: Nothing changed
- **WHEN** every entry on a sweep page matches its stored checksum and all required character-game links exist
- **THEN** no expanded fetch or game write is made for that page

#### Scenario: In-place character mug-shot edit
- **WHEN** a referenced IGDB mug shot keeps its ID but its checksum changes while its character's timestamp and checksum remain unchanged
- **THEN** the sweep refreshes the referencing character and persists the changed mug-shot metadata
- **AND** no related game is re-imported

#### Scenario: Mug shot has no local character
- **WHEN** a mug-shot sweep entry is not referenced by any locally stored character
- **THEN** no orphan image row is inserted

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
The system SHALL store each game and character's own IGDB `updated_at`. An import SHALL make no writes when its incoming source timestamp is older than that entity's stored value. Equal or newer values and entities with no stored value SHALL be imported normally. A character's recency SHALL NOT be compared with its games' timestamps.

#### Scenario: Stale data arrives after fresh data
- **WHEN** a game import carries an IGDB `updated_at` older than the one already stored for that game
- **THEN** no game or relationship writes are made and the skip is logged

#### Scenario: Child-only change
- **WHEN** a game import carries the same IGDB `updated_at` as stored but a changed child
- **THEN** the import proceeds and the child is updated

#### Scenario: Legacy row without a stored timestamp
- **WHEN** a stored game has no IGDB `updated_at`
- **THEN** the import proceeds and records the incoming value

#### Scenario: Stale character payload
- **WHEN** a character import carries an older source timestamp than that character's stored timestamp
- **THEN** no character, dependency or association writes are made and the skip is logged

#### Scenario: Equal character timestamp with changed dependency
- **WHEN** a character refresh has the same stored source timestamp but a changed mug shot or missing game link
- **THEN** the changed dependency or missing association is persisted

### Requirement: Delta operational visibility
The system SHALL report, for each delta stream, its watermark, the current window, entries applied, duration, and actionable failures, without logging full payloads or credentials.

#### Scenario: Operator checks freshness
- **WHEN** a delta pass finishes or a stream pauses
- **THEN** structured output identifies the stream, its watermark lag behind the current time, counts and any failure stage

## MODIFIED Requirements

### Requirement: Internal catalog fetching
The system SHALL automatically fetch catalog changes directly from IGDB using configured credentials, through delta polling and scheduled checksum sweeps, preserving the existing importer’s game metadata and relationships and adding character metadata and associations. The system SHALL NOT expose a legacy payload ingestion endpoint, per-game legacy queue worker, or webhook receiver.

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
The system SHALL default to a batch size of 25 for expanded game or character fetches, one concurrent game or character, and at most two concurrent relationship operations. Configured limits SHALL apply across each active sweep run and delta pass, SHALL be validated before execution, and SHALL NOT grow with total catalog size.

#### Scenario: Defaults on a large catalog
- **WHEN** a sweep or delta pass refreshes many games or characters with default configuration
- **THEN** each expanded fetch contains at most 25 games or characters and processing respects both concurrency limits regardless of catalog size

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

#### Scenario: Sweep and delta refresh the same character
- **WHEN** a sweep and a delta pass import the same character concurrently
- **THEN** their writes are serialized, older character data is rejected, and associations are not duplicated

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
