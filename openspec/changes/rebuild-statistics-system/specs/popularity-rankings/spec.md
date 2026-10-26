# Spec Delta

## Purpose

Let users discover eligible games and reviews through explicit period and recency rankings without query-time full-history scans or a catalog-sized result cache.

## ADDED Requirements

### Requirement: Popularity and recency have separate versioned definitions
Popular mode SHALL sum the versioned weights of accepted view impressions and first-known-like credits in the requested interval. Recent mode SHALL additionally decay contributions by interaction age, independently of source creation age. Responses SHALL identify the definition version and calculation time.

#### Scenario: Old game receives new engagement
- **WHEN** an old game receives more recent weighted engagement than another game
- **THEN** recent mode can rank it higher without penalizing its release or creation date

#### Scenario: One half-life elapses
- **WHEN** a contribution ages by the definition's half-life with no new engagement
- **THEN** its unrounded recent-mode contribution becomes half its previous value

### Requirement: Ranking inputs describe one unambiguous interval
The API SHALL accept either a supported period preset or an explicit start/end interval. Day/week/month/quarter/half-year/year presets SHALL mean rolling durations of 1/7/30/90/180/365 days anchored at the disclosed calculation time. Responses SHALL disclose effective boundaries. Popular mode SHALL support all time; recent mode SHALL require a finite interval. Invalid, conflicting, or excessive ranges SHALL be rejected.

#### Scenario: Calendar date and rolling day differ
- **WHEN** the day preset uses a published calculation time of 15:30 UTC
- **THEN** its interval starts 24 hours before that disclosed time rather than at midnight or a later request time

#### Scenario: Several interval selectors are supplied
- **WHEN** a request supplies a preset together with explicit start/end values
- **THEN** validation rejects the ambiguous interval before querying

### Requirement: Filters apply to the complete eligible source population
Game and review rankings SHALL apply current eligibility and their supported domain filters before limiting or paginating results. A fixed unfiltered top-N SHALL NOT remove otherwise matching sources. Sources with zero interactions SHALL remain eligible with zero score and deterministic tie-breaking.

#### Scenario: Matching game lies outside the unfiltered leaders
- **WHEN** a matching game would lie beyond the former unfiltered 50,000-game cutoff
- **THEN** it remains eligible in the filtered ranking and its total

#### Scenario: Review filters are combined
- **WHEN** game, author, and exclude-own filters are supplied
- **THEN** the ranking and its total describe their combined permitted result set

#### Scenario: Dataset contains zero-score sources
- **WHEN** matching eligible sources have no interactions
- **THEN** they appear with zero score under the same stable native-identity tie-breaker

### Requirement: Review priority preserves eligibility
An optional pinned review SHALL satisfy the same access and domain filters as ordinary ranking candidates. Only a qualifying pin SHALL precede ordinary score ordering; it SHALL NOT add an otherwise excluded review to the result population.

#### Scenario: Pinned review is excluded
- **WHEN** a pinned review belongs to another filtered game or is inaccessible
- **THEN** pinning does not bypass that restriction or alter the filtered total

#### Scenario: Pinned review is eligible
- **WHEN** a qualifying pinned review has a lower score than other matching reviews
- **THEN** it can precede their ordinary score ordering while subsequent items retain deterministic ordering

### Requirement: Pagination is accurate bounded and explicitly live
Ranking requests SHALL use integer limits from 1 to 100, default 20, and non-negative integer offsets no greater than 10,000. Totals SHALL describe the complete filtered population. Ordinary ordering SHALL use score and a unique native-identity tie-breaker. Pages SHALL have documented live-list semantics rather than promising a frozen traversal across score refreshes.

#### Scenario: Page exceeds available results
- **WHEN** a valid requested page lies beyond the filtered population
- **THEN** items are empty while totals remain accurate and hasNextPage is false

#### Scenario: Scores refresh during navigation
- **WHEN** engagement changes between two page requests
- **THEN** the response identifies its calculation time and the client can refresh the live ranking
- **AND** the API does not claim snapshot-consistent pagination

### Requirement: Served rankings honor current access
Ranking results and cached pages SHALL enforce current content existence, deletion, mature-content, and applicable privacy policies before serving identities, scores, or totals. Personalized filters SHALL NOT share cache results with another actor's effective filter context.

#### Scenario: Cached source becomes inaccessible
- **WHEN** a source is removed or becomes private after ranking calculation
- **THEN** a subsequent response does not expose its identity, score, or protected context through cache

#### Scenario: Two actors exclude their own reviews
- **WHEN** two users request exclude-own rankings with otherwise identical inputs
- **THEN** each result is evaluated for its authenticated actor

### Requirement: Ranking reads use prepared bounded data
Common ranking requests SHALL read prepared scores and limited result pages. Explicit intervals SHALL use temporal aggregates with exact boundary handling. Requests SHALL NOT hydrate the complete catalog or complete raw history into application or cache memory. Cache loss SHALL affect speed without losing statistics.

#### Scenario: Catalog size grows
- **WHEN** a page of 20 games is requested from a larger catalog
- **THEN** the application does not load all matching games or a fixed 50,000-statistics array to produce that page

#### Scenario: Result cache is empty
- **WHEN** a ranking is requested after cache eviction
- **THEN** it can be produced from persisted statistics with the same eligibility and score semantics

### Requirement: Replacement statistics contracts use source identities
The replacement API SHALL expose source summaries, source-based status, bounded metric series, durable view acceptance, and the common game/review ranking operation. Legacy per-table statistics IDs and queued mutation/trending routes SHALL be retired. The committed reaction operations introduced by content-reactions SHALL retain their paths, strict inputs, and response.

#### Scenario: Status is requested after schema replacement
- **WHEN** a client supplies a valid source type and native source ID
- **THEN** it can obtain its own engagement flags without learning a statistics-row ID

#### Scenario: Existing committed reaction route is called
- **WHEN** a client calls PUT or DELETE /statistics/like with a valid source-only request
- **THEN** it receives the committed isLiked and likesCount contract

#### Scenario: Obsolete trending or queued-view route is called
- **WHEN** a client calls a retired statistics operation after cutover
- **THEN** no legacy adapter, obsolete queue mutation, or alternate contract executes

### Requirement: Statistics input and output are allowlisted
Statistics requests SHALL validate source IDs, modes, metrics, ranges, pagination, and source-specific filters, rejecting unsupported properties and raw ordering or formula expressions. Public responses SHALL expose approved counters and source identities without raw events, actor histories, internal target IDs, or notification delivery state.

#### Scenario: Caller submits a raw formula or metric name
- **WHEN** a request supplies an unsupported metric, SQL-like order expression, or client-selected weight
- **THEN** it is rejected before executing a statistics query

#### Scenario: Public summary is returned
- **WHEN** an unauthenticated caller reads an eligible source summary
- **THEN** it contains approved aggregate values and freshness/coverage metadata without user-level history

### Requirement: Statistical operations preserve unrelated product semantics
Initial rankings SHALL use only the existing view/like interaction domain. Catalog import, projection replay, generated activity mirrors, and notification delivery SHALL NOT be interpreted as new engagement. Search ranking and notification inbox grouping SHALL continue following their own existing contracts.

#### Scenario: Notification retry or activity mirror is produced
- **WHEN** a committed action is delivered again or represented by a feed activity
- **THEN** that representation alone contributes no extra engagement score

#### Scenario: Catalog is refreshed
- **WHEN** unchanged games are imported again
- **THEN** their popularity is unchanged by import work itself
