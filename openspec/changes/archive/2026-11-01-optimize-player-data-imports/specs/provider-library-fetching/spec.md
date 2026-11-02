# Spec Delta

## Purpose

Retrieves complete and bounded gaming-platform library and achievement snapshots while preserving existing data when providers fail or return incomplete results.

## ADDED Requirements

### Requirement: Complete or explicitly incomplete snapshots

The system SHALL distinguish complete success, empty success, unsupported data, unavailable/private accounts, throttling, and incomplete failures when the installed client exposes sufficient evidence. The system SHALL retain `psn-api`; hidden HTTP status/headers and in-flight cancellation are out of scope, and ambiguous PSN errors SHALL remain failed/incomplete. Only complete successful snapshots SHALL advance synchronization success or be cached as successful refresh results.

#### Scenario: Failure after one successful page

- **WHEN** a later page fails after an earlier page was fetched
- **THEN** the result is incomplete, earlier persisted data remains intact, and the refresh is not marked successful

#### Scenario: Successful empty response

- **WHEN** the provider confirms a complete library or achievement result containing no entries
- **THEN** the system records a successful empty outcome rather than a transient failure

### Requirement: Bounded and progressive pagination

The system SHALL fetch all available pages with explicit supported limits and strictly advancing offsets or continuation tokens. It SHALL stop on exhaustion and fail visibly on repeated cursors, invalid pages, or exceeded processing bounds.

#### Scenario: PSN library exceeds one page

- **WHEN** a PSN account contains more trophy titles than one response can return
- **THEN** every page is requested once in order without assuming an unspecified default page size

#### Scenario: Provider repeats a continuation token

- **WHEN** a provider response would cause the next request to reuse an already processed cursor
- **THEN** processing terminates as an incomplete failure rather than looping indefinitely

#### Scenario: Achievement or library result exceeds maxItems

- **WHEN** a supported endpoint returns continuation information after its requested item limit
- **THEN** the remaining pages are fetched before the result is considered complete

### Requirement: Bound Xbox libraries at the service limit

Xbox library requests SHALL use `maxItems: 5000` and process no more than the first 5,000 returned titles. A structurally valid titles array SHALL count as a complete service snapshot at this bound, even when the provider response or its metadata indicates more titles. The service SHALL NOT invent cursor parameters or treat titles absent from the bounded snapshot as deleted.

#### Scenario: Xbox library reaches the requested cap

- **WHEN** TitleHub returns 5,000 titles or more without verified continuation
- **THEN** at most the first 5,000 titles are processed, cached, and considered complete under the service limit

#### Scenario: Xbox library is below the requested cap

- **WHEN** TitleHub returns a valid library with fewer than 5,000 titles and no indication of truncation
- **THEN** normal complete/empty handling applies without fabricated pagination requests

#### Scenario: Below-cap Xbox response indicates truncation

- **WHEN** TitleHub indicates that more titles remain or its total metadata disagrees with the returned count
- **THEN** the returned titles are considered a complete bounded service snapshot without an unverified cursor request

#### Scenario: Xbox response is malformed

- **WHEN** TitleHub omits the titles array
- **THEN** the response fails as incomplete because there are no safe titles to process

### Requirement: Non-overlapping Xbox statistics batches

Xbox statistics requests SHALL contain no more than 1,000 requested titles per batch, SHALL NOT overlap adjacent batches, and SHALL make forward progress after a successful response with no statistics.

#### Scenario: Empty first statistics batch

- **WHEN** a batch succeeds with an empty statistics collection and more titles remain
- **THEN** the system proceeds to the next bounded batch instead of repeating the empty batch

#### Scenario: Boundary-sized library

- **WHEN** 1,001 titles require statistics
- **THEN** the system requests a batch of 1,000 and a batch of one without duplicate title requests

### Requirement: Preserve Steam library fallback semantics

Steam library retrieval SHALL preserve the owned-library and recently-played combination, deduplicate by app identity, and prefer recent entries where both sources contain the same game.

#### Scenario: Family Sharing game exists only in recent results

- **WHEN** a recently played game is absent from the owned-library response
- **THEN** it remains eligible for mapping, playtime import, and achievement selection

#### Scenario: Required Steam request fails

- **WHEN** one required component of the combined Steam snapshot fails
- **THEN** the system preserves existing data and does not label the combined result complete

### Requirement: Include played Steam Family licenses in owned snapshots

The owned-games response SHALL include already-played Family licenses and preserve returned `family_shared` rows when absent from recent results. The adapter SHALL send `include_family_licenses=true` as a raw parameter rather than rely on `getUserOwnedGames` options. Recent results SHALL still win duplicate app IDs. A missing `rtime_last_played` SHALL NOT invalidate a Family row.

#### Scenario: Previously played Family game is outside the recent window

- **WHEN** the owned-games response includes a `family_shared` game absent from recently played
- **THEN** the game remains eligible for library mapping and playtime import even when `rtime_last_played` is absent

#### Scenario: Family rows are not included in `game_count`

- **WHEN** a family-enabled response has fewer owned games in `game_count` than entries in `games`, including zero with only `family_shared` rows
- **THEN** shared rows are processed as valid games, not rejected based on `game_count`

### Requirement: Confirmed empty Steam responses
The system SHALL normalize omitted Steam games arrays before SDK parsing only when the response confirms the complete endpoint result is empty. For family-enabled owned-games requests, `game_count: 0` alone does not confirm an empty result; `games: []` is required. Ambiguous, contradictory, private, or failed responses SHALL NOT become empty success.

#### Scenario: Steam confirms zero recent games without an array
- **WHEN** a recent response has `total_count: 0` and omits its games array
- **THEN** that component succeeds as empty through the installed SDK

#### Scenario: Family-enabled Steam response explicitly returns no games
- **WHEN** an owned-games response with Family licenses has `games: []`
- **THEN** that component succeeds as empty

#### Scenario: Missing or contradictory Steam data
- **WHEN** a required games array is missing, a zero owned count accompanies nonempty games not all marked `family_shared`, or the request fails
- **THEN** the component fails without advancing success or caching an empty snapshot

### Requirement: Verified PSN mapping identity

The system SHALL distinguish PSN trophy sets by communication ID and service name, preserve distinct verified sets, and avoid assigning trophies to a game solely because its display name matches an ambiguous title.

#### Scenario: Multiple sets share a service name

- **WHEN** two verified mappings have different communication IDs and the same service name
- **THEN** both sets remain eligible for retrieval and neither is discarded as a duplicate of the other

#### Scenario: Ambiguous title-name match

- **WHEN** a title name could refer to more than one game association
- **THEN** the association remains unresolved and diagnosable without attaching trophies to an unverified game

#### Scenario: New mapping and immediate achievement job

- **WHEN** a verified mapping is discovered during a refresh
- **THEN** it is available before dependent achievement processing begins
