# Spec Delta

## ADDED Requirements

### Requirement: Metadata-only game video ingestion

The system SHALL import the `videos` relationship from IGDB game responses, preserving each source record ID, game association, name, external video identifier and checksum when supplied. Video ingestion SHALL retrieve metadata only and SHALL NOT download, upload, transcode or inspect video files, thumbnails or streaming manifests.

#### Scenario: Game has multiple videos
- **WHEN** IGDB returns multiple expanded video records for a game
- **THEN** the local catalog stores each record with its source identity and metadata associated with that game
- **AND** `video_id` is exposed as `videoId`, following the API's existing camelCase convention

#### Scenario: Import has no media side effects
- **WHEN** a catalog page containing videos is imported
- **THEN** video metadata is obtained within the existing game-page request
- **AND** no request is made to YouTube or another media host, and no media file is written to local or object storage

### Requirement: Usable video references

The system SHALL preserve the original external video identifier and store an HTTPS YouTube watch URL derived from it when it is a non-empty string. The identifier SHALL be encoded as a query parameter, without controlling the URL scheme or host. Missing optional metadata SHALL remain absent or null; a missing or empty video identifier SHALL NOT produce a fabricated URL.

#### Scenario: Video has an external identifier
- **WHEN** a video has `video_id` equal to `abc123_Xy-Z`
- **THEN** its stored `videoId` remains `abc123_Xy-Z`
- **AND** its stored `url` is `https://www.youtube.com/watch?v=abc123_Xy-Z`

#### Scenario: Identifier contains URL metacharacters
- **WHEN** an external video identifier contains characters such as `&`, `?` or `#`
- **THEN** those characters are encoded within the `v` parameter
- **AND** the URL still uses HTTPS with the host `www.youtube.com`

#### Scenario: Optional fields are absent
- **WHEN** a video has a valid source record ID but no name, checksum or external video identifier
- **THEN** its identity and game association are retained with the optional metadata absent or null
- **AND** no watch URL or placeholder metadata is invented

### Requirement: Replay-safe video persistence

Video writes SHALL share the owning game's transaction, relationship concurrency limits and reconciliation policy. Reimporting a video SHALL update it by source record ID without duplicates. Missing, null or empty video collections, and individual records absent from a later response, SHALL NOT delete existing video metadata, matching the current one-to-many media import behavior.

#### Scenario: Repeated or updated record
- **WHEN** an eligible import reprocesses a video record, including one with an updated checksum and metadata
- **THEN** exactly one record exists for its source ID, with the imported metadata and corresponding derived URL
- **AND** existing game statistics are preserved

#### Scenario: Existing game has no imported videos
- **WHEN** a game with an unchanged base checksum is eligible for periodic or forced relationship reconciliation and its source response includes videos
- **THEN** its missing video records are imported
- **AND** no base checksum change or catalog progress reset is required

#### Scenario: Missing or empty relationship
- **WHEN** a source game omits `videos`, supplies null or an empty collection, or no longer includes a previously imported video
- **THEN** the game import succeeds without deleting existing video records
- **AND** no video rows are created from the absent entries

#### Scenario: Video write fails
- **WHEN** a required video write fails during a game import
- **THEN** that game's writes are rolled back together
- **AND** the page checkpoint is not advanced past the failed game
- **AND** a retry can persist the game and videos without duplicates

### Requirement: Video metadata validation

The system SHALL reject malformed video collections and entries before their game transaction commits. Each video SHALL have a positive safe-integer source record ID. Supplied non-null name, video identifier and checksum values SHALL be strings; a supplied game reference SHALL be a positive safe integer matching the containing game. Invalid video data SHALL enter the catalog failure policy without advancing the page checkpoint.

#### Scenario: Malformed video record
- **WHEN** a game's videos contain a non-object entry, an invalid source ID, a non-string metadata value or a game reference inconsistent with the containing game
- **THEN** the game import fails without committing partial game or video writes
- **AND** the failure identifies the game and video validation stage without logging the full source payload

#### Scenario: Malformed collection
- **WHEN** a non-null `videos` value is not an array
- **THEN** the import reports invalid source data rather than treating it as an empty successful relationship
- **AND** the page checkpoint remains unchanged

### Requirement: Video metadata retrieval

The existing single-game and multiple-game repository queries SHALL support requesting `relations.videos` and return the imported video metadata, including the derived URL when available. The existing resource lookup SHALL accept `videos`. Video relationships SHALL remain opt-in, following the existing relation-loading contract.

#### Scenario: Request imported videos
- **WHEN** a client requests a game or multiple games with `relations.videos` enabled
- **THEN** each game's `videos` collection contains its imported video records and available URLs
- **AND** a game without imported videos returns an empty collection

#### Scenario: Existing requests and resource lookup
- **WHEN** a client omits the videos relationship or requests the `videos` resource
- **THEN** the former follows existing default relation loading and the latter returns the stored video records through the existing resource route
