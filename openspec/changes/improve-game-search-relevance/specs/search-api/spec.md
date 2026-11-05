# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
