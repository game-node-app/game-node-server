# Proposal

## Why

Users cannot find a game inside their own library. The only search (`/v1/search/games`) queries the
whole GameNode catalog through Manticore, so a user with hundreds or thousands of imported games has
to page through the library listing. Library imports (Steam, PSN, Xbox, GOG, Epic, Nintendo) make
libraries of 1–5k entries normal; the largest production library already has 2,295 entries.

## What Changes

- Add an optional `search` text parameter to the three library entry listings:
  `GET /v1/collections-entries/library/{id}`, `GET /v1/collections-entries/library/{userId}/favorites`
  and `POST /v1/collections-entries/collection/{id}`. It narrows the listing to entries whose game
  title or one of its alternative names contains the search text. Everything else about the listing
  stays the same: visibility rules, status, game filters, custom-cover filter, ordering, pagination
  and response shape.
- Matching ignores case, Latin accents, apostrophes and punctuation, the same way the catalog search
  normalizes text, so `assassins creed`, `Assassin’s Creed` and `half life` find the expected games.
- Search runs only over the target library in MySQL. It never queries the global catalog or
  Manticore, so it sees games added a second ago and has no dependency on the daily index rebuild.
- Persist a normalized copy of every game title and alternative name as MySQL `STORED` generated
  columns (`game.searchName`, `game_alternative_name.searchName`), so the per-entry match is a
  plain `LIKE` instead of three regular expressions per row. MySQL keeps them in sync on every
  insert and update; no sync or importer code changes.
- Write `handoff-clients.md` describing the contract and the client work. Client implementation is a
  separate change in `game-node-clients`.

No breaking change for released clients: the parameter is optional and omitted means today's
behavior. Regenerating the TypeScript client adds a positional argument (see the hand-off).

## Capabilities

### New Capabilities
- `library-game-search`: text search scoped to the entries of one library (or one collection or the
  favorites of a library), with catalog-compatible text normalization, the library's visibility
  rules, and bounded per-library cost.

### Modified Capabilities

None. `search-api` (catalog search) is unchanged; this capability reuses its query normalization
function without changing its contract.

## Impact

- **API**: `FindCollectionEntriesDto` gains `search` (max 256 characters), which also appears on
  `FindCollectionEntriesForCollectionIdDto`. Swagger (`server_swagger.json`) changes.
- **Code**: `src/collections/collections-entries/collections-entries.service.ts` (three listing
  methods), the DTO, `src/search/search.service.ts` (export the existing normalization function),
  `Game` and `GameAlternativeName` entities.
- **Database**: one migration adds two `STORED` generated columns. Adding a stored column rebuilds
  the table: `game` (~231 MB, ~360k rows) and `game_alternative_name` (~46 MB). Writes to these
  tables wait during the migration; reads continue.
- **Not affected**: Manticore indexes and catalog search, IGDB sync and importers (MySQL fills the
  generated columns), MCP tools.
- **Clients**: hand-off only; mobile and web implement the search box in `game-node-clients`.
