# Spec Delta

## MODIFIED Requirements

### Requirement: Checksum sweep comparison
A scheduled catalog run SHALL sweep each tracked IGDB endpoint in ascending ID order, comparing `id`, `checksum`, ownership IDs and each endpoint's declared compared fields against local values. Only missing rows, changed checksums or differing compared fields SHALL trigger refreshes through the delta routing. Rows classified as cover option sources SHALL instead be compared against stored cover options and SHALL NOT refresh their parent game.

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

#### Scenario: Alternative or historical cover unchanged
- **WHEN** a sweep sees an alternative or historical cover whose stored option has the same checksum
- **THEN** no fetch or write is made for it and its parent game is not refreshed

#### Scenario: Primary cover classified as an option source
- **WHEN** a cover row has an alternative or historical image type but is stored as a game's primary cover
- **THEN** it follows the primary cover comparison and its parent game is refreshed if its checksum changed

## ADDED Requirements

### Requirement: Cover option ingestion
Sweeps SHALL store as cover options the localized covers, the alternative and historical covers from `covers`, and the alternative and historical covers from `artworks`. New or changed sources SHALL be written idempotently without refreshing the parent game. Other cover types SHALL NOT become options.

#### Scenario: New localized cover
- **WHEN** a sweep sees a localized cover with no stored option, whose game exists locally
- **THEN** an option of kind `localized` is stored for that game, labeled with the localization's region

#### Scenario: Alternative artwork
- **WHEN** a sweep sees an artwork of the alternative or historical cover type with no stored option
- **THEN** an option of the matching kind is stored for that game

#### Scenario: Unrelated artwork
- **WHEN** a sweep sees an artwork of any other type
- **THEN** no option is stored for it

#### Scenario: Changed option source
- **WHEN** a stored option's source keeps its ID and its checksum changes
- **THEN** the option's image data is updated and existing user choices of that option remain

#### Scenario: Game absent locally
- **WHEN** an option source references a game that is not stored locally
- **THEN** no option is stored, the sweep continues, and a later sweep can store it

#### Scenario: Replay after interruption
- **WHEN** a sweep page is replayed after a crash
- **THEN** no duplicate option is created

### Requirement: Cover option retention
A cover option SHALL NOT be deleted because its source is absent from an IGDB response. Removing a local option SHALL remove the user choices that reference it.

#### Scenario: Source no longer returned
- **WHEN** a completed sweep did not see the source of a stored option
- **THEN** the option remains stored and listed

#### Scenario: Option removed locally
- **WHEN** a stored option is deleted
- **THEN** user choices referencing it are removed and those users see the default cover

### Requirement: Edition link storage
Game imports SHALL store the IGDB `version_parent` link and `version_title` when the parent game exists locally. The link SHALL be a compared field in sweeps, so existing games and parents imported later are linked without a separate backfill.

#### Scenario: Edition imported after its base game
- **WHEN** an edition is imported and its base game exists locally
- **THEN** the edition's link and title are stored

#### Scenario: Base game not yet stored
- **WHEN** an edition is imported and its base game does not exist locally
- **THEN** the edition is imported without a link, no placeholder base game is created, and a later sweep stores the link once the base game exists

#### Scenario: Existing edition with unchanged checksum
- **WHEN** a sweep sees an edition whose stored link differs from IGDB and whose base game exists locally
- **THEN** the edition is re-imported and the link is stored

### Requirement: Edition cover options
Importing a game that has a cover and is an edition, or is the base game of a stored edition, SHALL store that game's cover as one `edition` option on its base game, updating that same option when the cover changes so existing user choices remain.

#### Scenario: Edition imported
- **WHEN** an edition with a cover and a stored base game is imported
- **THEN** its cover is stored as an `edition` option of the base game, labeled with the edition title

#### Scenario: Edition cover replaced
- **WHEN** an edition's primary cover changes on IGDB and the edition is re-imported
- **THEN** its existing option holds the new image and user choices of that option remain

#### Scenario: Base game of an edition imported
- **WHEN** a base game with a stored edition and a cover is imported
- **THEN** its cover is available as an option for its editions

#### Scenario: Game with no editions
- **WHEN** a game that is neither an edition nor the base of a stored edition is imported
- **THEN** no `edition` option is stored for it
