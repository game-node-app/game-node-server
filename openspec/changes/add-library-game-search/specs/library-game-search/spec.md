# Spec Delta

## Purpose

Let a viewer find games inside one library, one collection, or a library's favorites by name,
without searching the whole GameNode catalog and without bypassing library visibility.

## ADDED Requirements

### Requirement: Optional search on library listings
The library listing, the library favorites listing, and the collection entries listing SHALL accept an optional `search` text. When present, only entries whose game matches it SHALL be returned. Omitted, empty, or whitespace-only `search` SHALL return exactly today's listing.

#### Scenario: Search narrows the library listing
- **WHEN** a library contains Halo 3, Halo Infinite and Celeste and the owner lists it with search `halo`
- **THEN** only the Halo 3 and Halo Infinite entries are returned, with `pagination.totalItems` 2

#### Scenario: Blank search keeps the current listing
- **WHEN** a caller sends search `"   "` or omits it
- **THEN** the response equals the same request without search

#### Scenario: Favorites and collections accept the same search
- **WHEN** a caller searches `halo` on a library's favorites or on one collection
- **THEN** only favorite entries, or only entries of that collection, whose game matches are returned

### Requirement: Search covers only the target entries
Search SHALL consider only games that have an entry in the target library, favorites, or collection. Catalog games without such an entry SHALL never be returned, and search SHALL NOT depend on the catalog search engine or its index schedule.

#### Scenario: Catalog game outside the library
- **WHEN** the catalog contains Halo 2 and the library does not
- **THEN** searching the library for `halo 2` returns no entry

#### Scenario: Recently added entry
- **WHEN** a user adds a game to the library and searches its name immediately after
- **THEN** the new entry is returned without waiting for any index rebuild

#### Scenario: Catalog search engine unavailable
- **WHEN** the catalog search engine is down
- **THEN** library search still succeeds

### Requirement: Title and alternative-name containment
An entry SHALL match when the normalized search text occurs as a contiguous substring of its game's normalized title or of one individual normalized alternative name. Occurrences spanning two names SHALL NOT match.

#### Scenario: Partial word while typing
- **WHEN** the library contains Minecraft and the caller searches `minec`
- **THEN** the Minecraft entry is returned

#### Scenario: Alternative name
- **WHEN** a game titled The Legend of Zelda: Breath of the Wild has the alternative name BOTW
- **THEN** searching `botw` returns its entry

#### Scenario: Words out of order
- **WHEN** the caller searches `life half` and the library contains Half-Life
- **THEN** the Half-Life entry is not returned

### Requirement: Catalog-compatible text normalization
Matching SHALL ignore letter case and Latin accents, treat straight, curly, and omitted apostrophes as equivalent, and treat runs of other punctuation, symbols, and whitespace as one space, consistently with catalog game search. Returned names SHALL stay unchanged.

#### Scenario: Apostrophes
- **WHEN** the library contains Assassin's Creed
- **THEN** `Assassin's Creed`, `Assassin’s Creed` and `assassins creed` all return it

#### Scenario: Accents and case
- **WHEN** the library contains Pokémon: Let's Go, Pikachu!
- **THEN** `POKEMON LETS GO`, `pokémon`, and `Poke` followed by a combining acute accent and `mon` all return it, and the response shows the original title

#### Scenario: Punctuation
- **WHEN** the library contains Half-Life 2
- **THEN** `half life 2` and `half-life` return it

#### Scenario: Input with only ignored characters
- **WHEN** a nonblank search contains only punctuation, symbols, or apostrophes, such as `'` or `%%%`
- **THEN** the response is an empty page with `totalItems` 0, not the unfiltered listing

#### Scenario: Wildcard characters are literal
- **WHEN** a caller searches `100%` or `_`
- **THEN** those characters never act as wildcards and only titles matching the normalized text are returned

### Requirement: Visibility and existing filters still apply
Search SHALL narrow the result of the existing listing rules and never widen them. Library visibility, entry visibility, collection privacy, status, game filters (including the default categories), custom-cover filter, ordering, and pagination SHALL apply as without search, with totals over visible matches.

#### Scenario: Hidden entry matches the text
- **WHEN** an anonymous viewer searches `halo` in a public library whose Halo 3 entry is `private`
- **THEN** Halo 3 is neither returned nor counted

#### Scenario: Hidden library
- **WHEN** a viewer who may not see the library searches it
- **THEN** the response is an empty page, as without search

#### Scenario: Default category filter
- **WHEN** the library contains a DLC whose title matches and the caller sends no game filters
- **THEN** the DLC is not returned, and it is returned when the caller's categories include DLCs

#### Scenario: Ordering and pages
- **WHEN** 25 visible entries match and the caller requests `orderBy[addedDate]=DESC`, offset 20 and limit 20
- **THEN** the last 5 matches in added-date order are returned with `totalItems` 25

### Requirement: Validated search input
`search` SHALL be a single string of at most 256 characters. Longer values SHALL be rejected with 400 before any query runs. The search text SHALL never select tables, columns, or SQL fragments.

#### Scenario: Too long
- **WHEN** a caller sends a 257-character search
- **THEN** the API returns 400

#### Scenario: SQL-like text
- **WHEN** a caller searches `' OR 1=1 --`
- **THEN** the text is treated as literal search input and returns only entries matching its normalized form

### Requirement: Cost bounded by the target listing
Search cost SHALL grow with the number of entries in the target library, favorites, or collection, not with the catalog size, and SHALL NOT evaluate regular expressions per entry at query time.

#### Scenario: Largest library
- **WHEN** a library with at least 2,000 entries is searched with a one-word text matching hundreds of entries
- **THEN** the database work is limited to that library's entries, each matched against precomputed normalized names
