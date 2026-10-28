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
Game search SHALL match names and alternative names with the existing anchored phrase behavior. Results SHALL order by relevance descending, views descending, release date descending, then game ID ascending. Empty or omitted game queries SHALL browse using the supplied filters.

#### Scenario: Alternative name and equal scores
- **WHEN** a query matches an alternative name and several games have equal relevance
- **THEN** the alternative-name game is eligible and views, release date, and ID determine a stable result order

#### Scenario: Filter-only discovery
- **WHEN** the game query is empty and a category is supplied
- **THEN** matching category games are returned without requiring a full-text term

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
Autocomplete SHALL reuse game matching and filters with a prefix query, force page 1 and limit 5, and return `{data:string[],total:number}` where total is the number of returned names. Empty autocomplete input SHALL return an empty result without an engine query.

#### Scenario: Suggestions ignore caller pagination
- **WHEN** a caller submits a prefix with page 3 and limit 100
- **THEN** up to five names from the first matching page are returned

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
