# Spec Delta

## Purpose

Imports an authenticated user's owned GOG games and GOG-recorded cumulative playtime while maintaining renewable credentials and preserving local data on upstream failures.

## ADDED Requirements

### Requirement: Renewable per-connection GOG credentials
The system SHALL encrypt GOG access and refresh tokens per connection, reuse fresh access tokens and serialize token refreshes for that connection. Definitively invalid or missing refresh grants SHALL require re-authentication. Temporary provider failures SHALL preserve credentials and remain retryable. Tokens, authorization codes and token-request URLs SHALL NOT appear in API responses or logs.

#### Scenario: Concurrent refreshes
- **WHEN** two workers need to refresh one GOG connection
- **THEN** only the lock owner exchanges and persists tokens, and the next worker rereads the saved credentials before refreshing

#### Scenario: Refresh rotates the grant
- **WHEN** GOG returns a replacement refresh token
- **THEN** the replacement and access-token expiry are stored together before further authenticated calls

#### Scenario: Grant is no longer usable
- **WHEN** GOG definitively rejects the refresh grant or the connection has no refresh token
- **THEN** the connection becomes `reauth_required` and automatic synchronization stops until reconnection

#### Scenario: Transient refresh failure
- **WHEN** a refresh times out, is throttled or receives an upstream server error
- **THEN** the stored credentials and authentication status remain unchanged and synchronization can retry

### Requirement: Complete owned GOG library
The system SHALL retrieve all pages of the account's owned GOG releases, deduplicate by GOG product ID and exclude releases belonging to other platforms or marked unowned. Unplayed owned games SHALL remain eligible for import. Invalid pages, repeated continuation tokens or unfinished pagination SHALL fail without treating the partial library as complete.

#### Scenario: Mixed Galaxy library
- **WHEN** the account contains owned GOG games, unplayed GOG games, unowned releases and linked Steam games
- **THEN** only owned GOG games are offered for import, including those without playtime

#### Scenario: Paginated library
- **WHEN** GOG returns more than one library page
- **THEN** all pages are read before matching or committing import results

#### Scenario: Later page fails or cursor cycles
- **WHEN** a later page fails or a continuation token has already been visited
- **THEN** synchronization fails as incomplete without advancing library success or removing existing games

#### Scenario: Confirmed empty library
- **WHEN** a complete valid GOG response contains no owned GOG games
- **THEN** library synchronization succeeds as empty

### Requirement: GOG product identity and import behavior
The system SHALL match GOG product IDs against the existing `Gog` category and import on PC. Manual and automatic imports SHALL honor the existing processed/ignored entries and destination-collection ownership rules. Unmapped IDs SHALL enter curation without title-based guesses or new external-game categories.

#### Scenario: Existing mapping
- **WHEN** an owned GOG product has an existing IGDB or GameNode mapping
- **THEN** the mapped game is a PC import candidate unless already processed or ignored

#### Scenario: Automatic import destination
- **WHEN** a GOG connection has automatic import enabled and a valid destination collection
- **THEN** mapped unprocessed games enter that collection through the existing import lifecycle

### Requirement: GOG cumulative playtime
The system SHALL import validated GOG cumulative time as seconds under source `gog` on PC without adding the same total on subsequent runs. Missing or failed time responses SHALL NOT become zero. Dates and counts SHALL only come from verified provider fields; unavailable values SHALL remain unset or preserve stored values. The system SHALL NOT write sessions back to GOG.

#### Scenario: Repeated total
- **WHEN** two successful synchronizations return the same cumulative time for a game
- **THEN** the stored total remains unchanged and no additional playtime is counted

#### Scenario: Missing provider time
- **WHEN** a required playtime response is malformed, unavailable or fails
- **THEN** existing playtime remains intact and the stage is not recorded as complete

#### Scenario: No GOG-recorded activity
- **WHEN** GOG confirms a cumulative total of zero for an owned game
- **THEN** the game remains importable and eligible for achievement checks

### Requirement: Account-scoped provider failure handling
GOG player requests SHALL use account-scoped throttling, bounded requests and the shared synchronization deadlines. A throttle for one GOG account SHALL NOT pause unrelated accounts. Cancellation or incomplete results SHALL NOT advance success or overwrite existing data with empty results.

#### Scenario: One account is throttled
- **WHEN** GOG returns HTTP 429 for one account
- **THEN** its retry observes the reported cooldown while another account remains eligible

#### Scenario: Attempt expires
- **WHEN** the synchronization deadline expires during GOG retrieval
- **THEN** no later writes from that attempt are accepted and the unfinished work remains retryable
