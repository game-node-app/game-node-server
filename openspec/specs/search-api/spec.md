# Search API Specification

## Purpose

Provide game discovery and public username lookup through the main API while preserving the search contract used by existing GameNode clients.

## Requirements

### Requirement: Compatible public routes
The API SHALL accept unauthenticated JSON POST requests at `/search/games`, `/search/games/autocomplete`, and `/search/users`, and equivalent `/v1/search/*` routes. Successful requests SHALL return HTTP 200 with JSON and support existing browser cross-origin requests.

#### Scenario: Released client uses the legacy URL
- **WHEN** a released client posts to its existing search hostname after cutover
- **THEN** the main API handles the request directly without a redirect, session requirement, or Go API dependency

### Requirement: Game matching and ordering
Game search SHALL match the complete normalized input phrase within a title or individual alternative name. Results SHALL order by normalized exact title-or-alias match first, critic-review count descending (null as zero), textual relevance descending, release timestamp descending, then game ID ascending. Critic coverage SHALL NOT restrict eligibility. Empty or omitted queries SHALL browse supplied filters with no exact-match or textual preference.

#### Scenario: Alternative name and equal scores
- **WHEN** several matching games have equal exact-match priority, critic counts, and textual relevance
- **THEN** release timestamp descending and ID ascending determine a stable order, including games matching an alternative name

#### Scenario: Filter-only discovery
- **WHEN** the game query is empty and a category is supplied
- **THEN** matching category games are returned without requiring a full-text term, ordered by critic count descending, release timestamp descending, and ID ascending

#### Scenario: Exact name outranks a popular partial match
- **WHEN** a game has a normalized title or individual alias equal to the query and another game only contains that phrase with more critic reviews
- **THEN** the exact match appears first even when it has no critic reviews

#### Scenario: Exact alternative name identifies the original game
- **WHEN** a fixture named Minecraft: Java Edition has alias Minecraft and 14 critic reviews, Minecraft: Legends has 5, and another game named Minecraft has no critic reviews
- **THEN** searching Minecraft places Minecraft: Java Edition ahead of both other fixtures

#### Scenario: Critic counts precede local engagement and engine relevance
- **WHEN** two matches have the same exact-match priority and one has more critic reviews while the other has more views or higher textual relevance
- **THEN** the game with more critic reviews appears first

#### Scenario: Unreviewed games remain searchable
- **WHEN** matching games have null, zero, or positive critic counts and no explicit caller filter excludes them
- **THEN** all remain eligible, with null and zero treated equally for ordering

#### Scenario: Phrase matching preserves term order and alias boundaries
- **WHEN** input words occur out of order, only inside longer words, or across two separate aliases without the complete phrase occurring in a single name
- **THEN** those occurrences alone do not match the query

#### Scenario: Input is literal search text
- **WHEN** a query contains quotes, parentheses, asterisks, or other engine query operators
- **THEN** the caller cannot alter server-selected fields, boolean clauses, filters, or wildcard behavior through those characters

### Requirement: All declared game filters apply
Game search SHALL support category/status integer arrays and genre/theme/platform string arrays. Values within one field SHALL use OR; populated fields SHALL combine with AND. Empty arrays SHALL add no restriction. String values SHALL resolve as exact case-insensitive resource names or decimal IDs; platform abbreviations SHALL also resolve. Unresolved values SHALL never remove a restriction.

#### Scenario: Combined relation filters
- **WHEN** genres contains two resource names and platforms contains one abbreviation
- **THEN** each result has either genre and the specified platform, with totals computed for the combined filter

#### Scenario: Unknown filter values
- **WHEN** a nonempty filter contains only unrecognized values
- **THEN** no games match rather than returning unfiltered games

### Requirement: Compatible search response data
Search SHALL return `{data:{items,took},pagination:{totalItems,totalPages,hasNextPage}}`, with items always an array. Game items SHALL retain legacy camelCase flattened fields, numeric game IDs, string source `manticore`, and ISO date strings. User items SHALL contain only `userId` and `username`. Legacy optional fields SHALL remain optional.

#### Scenario: Existing game card consumes a result
- **WHEN** a game has cover, genre, theme, platform, keyword, and popularity data
- **THEN** its result includes the legacy flattened field names and comma-separated relation labels without requiring a client change

#### Scenario: No matching users
- **WHEN** username search has no matches
- **THEN** data.items is an empty array and pagination totals are zero

### Requirement: Accurate bounded pagination
Game and user search SHALL default to limit 20 and page 1 when omitted or zero. Limits SHALL be integers from 1 to 100 and effective offset SHALL be at most 10000. Total pages SHALL equal ceiling(totalItems/limit); hasNextPage SHALL reflect the requested page and total, including empty pages beyond the last page. Totals SHALL describe the complete filtered result set.

#### Scenario: Last user page
- **WHEN** 21 users match and page 2 with limit 20 is requested
- **THEN** one item is returned with totalItems 21, totalPages 2, and hasNextPage false

#### Scenario: Empty page beyond the end
- **WHEN** 21 games match and page 3 with limit 20 is requested
- **THEN** items is empty while totalItems remains 21, totalPages remains 2, and hasNextPage is false

### Requirement: Game autocomplete
Autocomplete SHALL reuse game normalization, ordering, and filters, matching complete preceding words and a prefix of the final word in a title or individual alias. It SHALL force page 1 and limit 5, return `{data:string[],total:number}`, and return empty results without an engine query for blank or normalization-empty input. Total SHALL be the number of returned names.

#### Scenario: Suggestions ignore caller pagination
- **WHEN** a caller submits a prefix with page 3 and limit 100
- **THEN** up to five names from the first matching page are returned

#### Scenario: Prefix typing retains the same ranking policy
- **WHEN** a caller types Minec and later Minecraft against fixtures for the original game, spinoffs, and unreviewed fan games
- **THEN** partial-word suggestions use critic counts before textual relevance, and the completed query promotes exact title-or-alias matches

#### Scenario: Autocomplete accepts equivalent spelling
- **WHEN** a caller submits accented, decomposed-accent, straight-apostrophe, curly-apostrophe, or omitted-apostrophe variants of the same prefix
- **THEN** the equivalent variants return the same ordered suggestions with original display names

### Requirement: Equivalent game-name spellings
Game matching and exact-match priority SHALL use consistent case folding, Latin accent folding, canonical Unicode equivalence, and equivalence of straight, curly, and omitted apostrophes within words. Normalization SHALL apply to titles, individual aliases, and input without changing returned names. It SHALL NOT expand contractions into different words or search image text.

#### Scenario: Omitted apostrophe in a contraction
- **WHEN** a fixture is named I'm on Observation Duty
- **THEN** I'm on Observation Duty, I’m on Observation Duty, and Im on Observation Duty find the same game with equal exact-match priority

#### Scenario: Omitted apostrophe in a possessive
- **WHEN** a fixture is named Assassin's Creed
- **THEN** Assassin's Creed, Assassin’s Creed, and Assassins Creed produce equivalent matches and exact-match priority

#### Scenario: Composed and decomposed accents
- **WHEN** input spells Pokémon using precomposed é, e followed by a combining acute accent, unaccented Pokemon, or different casing
- **THEN** all variants produce the same ordered results for equivalent indexed titles and aliases

#### Scenario: Normalization produces no searchable text
- **WHEN** nonblank game input contains only ignored apostrophes or combining marks
- **THEN** search and autocomplete return no matches rather than browsing the catalog

### Requirement: Username prefix matching
User search SHALL require a nonblank query, match username prefixes, retain engine relevance order with userId as a stable tie-breaker, and expose no additional profile or account data.

#### Scenario: Prefix lookup
- **WHEN** a public caller searches a username prefix
- **THEN** matching public usernames and their userIds are returned using the search pagination envelope

### Requirement: Validated and bounded engine access
The API SHALL reject malformed bodies, wrong field types, query lengths over 256 characters, invalid category/status values, filter arrays over 100 entries, filter strings over 256 characters, negative/fractional pagination, and excessive offsets with 400. It SHALL bound engine requests to five seconds and prevent client input from choosing an engine host, table, field, or raw engine request.

#### Scenario: Invalid numeric input
- **WHEN** a caller supplies a negative page or a string as limit
- **THEN** validation returns 400 before contacting Manticore

#### Scenario: Engine failure
- **WHEN** Manticore is unavailable, exceeds the timeout, or returns a malformed response
- **THEN** the API returns a controlled 503, 504, or 502 respectively without exposing engine bodies, SQL, credentials, or stack traces

### Requirement: Profiling compatibility
The API SHALL accept the legacy boolean profile field without exposing engine execution profiles to public clients. The optional response profile field SHALL be omitted, matching the legacy handler's lack of profile forwarding.

#### Scenario: Public caller requests profiling
- **WHEN** a game request includes profile true
- **THEN** search succeeds normally and engine execution details are absent
