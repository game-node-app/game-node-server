# Design

## Context

- The three entry listings live in `CollectionsEntriesService`: `findAllByUserIdWithPermissions`
  (library), `findFavoritesByUserId` and `findAllByCollectionIdWithPermissions`. Each resolves
  `LibraryAccessService`, then runs one TypeORM `findAndCount` with `where` find-options
  (`libraryUserId`, `visibility: In(visibleEntryLevels)`, `status`, `gameId`, `game: …filters`),
  `take/skip` pagination and the shared `relations`. All three take `FindCollectionEntriesDto`
  (the collection route via `FindCollectionEntriesForCollectionIdDto`), which today omits
  `BaseFindDto.search`.
- Catalog search (`src/search`) normalizes queries with `normalizeGameSearchQuery` (NFD, strip
  marks, drop `'‘’＇`, punctuation/symbols → space, collapse whitespace) and matches Manticore's
  normalized `name_search`. Manticore is rebuilt daily and only knows catalog data.
- `game.name` (varchar 255) and `game_alternative_name.name` (text) use `utf8mb4_0900_ai_ci`, so
  `LIKE` is already case- and accent-insensitive. `collection_entry` is indexed on
  `(libraryUserId, visibility)`; `game_alternative_name` on `gameId`.
- Production measurements (largest library, 2,295 entries, MySQL 8.4, warm buffer pool):
  - per-row `REGEXP_REPLACE` normalization of title + aliases: **117–140 ms** per query;
  - plain `LIKE` on the title through the same scoped join: **26 ms**.
  `findAndCount` runs the predicate twice (count + page), so query-time normalization would cost
  ~250 ms per keystroke today and grow linearly with library size.
- A probe on the dev MySQL 8.4 confirmed that `REGEXP_REPLACE(... '[\\p{P}\\p{S}]+' ...)` is
  accepted in a `STORED` generated column, keeps `utf8mb4_0900_ai_ci`, and that
  `searchName LIKE '%pokemon lets go%'` matches `Pokémon: Let’s Go, Pikachu!`.

## Goals / Non-Goals

**Goals:**
- One shared predicate used by all three listings; no second code path for search.
- Per-request cost proportional to the target listing, with no per-row regex.
- No new service, index, cache or sync job to keep consistent.

**Non-Goals:**
- Relevance ordering (exact match first). Search filters the listing the user is looking at and
  keeps its order (see decision 4).
- Typo tolerance, fuzzy matching, word-order independence, search in summaries, platforms or genres.
- A separate autocomplete route; the listing with a small `limit` already serves type-ahead.
- MCP tool changes, catalog search changes, and the pre-existing unordered default of the listings
  when no `orderBy` is sent.

## Decisions

### 1. MySQL predicate over the scoped entries, not Manticore

Search is a condition added to the existing `findAndCount`. MySQL walks only the target entries
through `(libraryUserId, visibility)` (or the collection map) and checks each entry's game by
primary key and its aliases by `gameId`.

Alternatives:
- **Manticore with `id IN (<library game ids>)`**: reuses catalog ranking, but needs every library
  game id in each request, misses games created since the last daily rebuild, adds a hard
  dependency on the engine, and splits pagination and visibility across two systems.
- **MySQL FULLTEXT (ngram) on `game.name`**: searches the whole catalog first; short queries like
  `re` hit hundreds of thousands of rows before the library join.
- **In-memory or Redis per-user name index**: fast, but needs invalidation on every entry change,
  catalog rename and visibility change. Not worth it at these sizes.

### 2. Precomputed normalized names as `STORED` generated columns

Add `searchName` to `game` and `game_alternative_name`:

```sql
GENERATED ALWAYS AS (TRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(
  `name`, '[\'‘’＇]', ''), '[\\p{P}\\p{S}]+', ' '), '\\s+', ' '))) STORED
```

Type matches the source column (`varchar(255)` for `game`, `text NULL` for aliases). Case and
accents are left to the column collation, so the stored value keeps the original letters. MySQL
computes it on every insert and update, so IGDB sync, importers and admin edits need no change.

Declare both on the entities with `generatedType: "STORED"`, `asExpression` (same string as the
migration), `insert: false`, `update: false`, `select: false`, so TypeORM never writes them, never
returns them in API responses, and `migration:generate` sees no drift.

Alternatives:
- **Normalize at query time**: measured above; ~5× slower and grows with every new library.
- **`VIRTUAL` generated column**: instant DDL, but recomputes the regex on every read, which is
  exactly the cost we are removing.
- **App-maintained column**: needs hooks in IGDB sync and every writer; easy to miss one.
- **Denormalized text on `collection_entry`**: becomes stale when IGDB renames a game.
- **One per-game column with the title and all aliases joined**: saves the alias lookup, but a
  generated column cannot read other rows, so the sync (or triggers) would have to rebuild it on
  every alias change, and a separator would have to keep matches from spanning two names. The
  per-row column handles any number of aliases: production games have at most 27 (1.4 on average
  when they have any; at most 16 in libraries), and the `gameId` lookup measured ~0.02 ms per entry.

### 3. Query side: reuse the catalog normalizer, then a plain `LIKE`

Export the existing `normalizeGameSearchQuery` from `src/search/search.service.ts` (do not copy
it). It strips marks after NFD, so decomposed accents in the input work; its output contains no
punctuation, so `%`, `_` and `\` can never reach the `LIKE` pattern. Build the pattern as
`%${normalized}%` and bind it as a parameter.

The predicate is a TypeORM `Raw` on `gameId`, combined with the custom-cover `In(...)` through
TypeORM's `And` when both apply:

```sql
(EXISTS (SELECT 1 FROM game g WHERE g.id = <gameId> AND g.searchName LIKE :librarySearch)
 OR EXISTS (SELECT 1 FROM game_alternative_name a
            WHERE a.gameId = <gameId> AND a.searchName LIKE :librarySearch))
```

Put it in one private helper of `CollectionsEntriesService` that returns the `gameId` condition
(or `undefined` without search) and an `empty` flag when nonblank input normalizes to nothing, so
the three methods return `[[], 0]` early exactly like the custom-cover short-circuit.

Matching each alias separately keeps the "no match across two names" rule without separators.

### 4. Keep the listing order; no relevance ranking

The client's `orderBy` (added date, release date, collection custom order) applies unchanged.
Library search is a filter over a small set the user is browsing; keeping its order means the
result does not jump when the user types one more letter, and it avoids a raw `ORDER BY`
expression that TypeORM `findAndCount` with relations and `take/skip` cannot express without
rewriting the three listings as query builders.

Alternative: rank exact title/alias matches first like catalog search. Revisit only if users report
that short queries bury the obvious game; it would need an id-page query plus hydration.

### 5. DTO

Redeclare `search` on `FindCollectionEntriesDto` (keep omitting it from `BaseFindDto` so the
validation is local): `@IsOptional() @IsString() @MaxLength(256)` and the existing
blank-to-`undefined` transform. `ApiPropertyOptional` with `maxLength: 256` so Swagger documents
it. The collection DTO inherits it; the favorites route already takes `FindCollectionEntriesDto`.

### 6. Client hand-off

The implementer writes `handoff-clients.md` in this change from the implemented DTOs and the
regenerated `server_swagger.json`, covering:
- the parameter on the three routes (query string for the two `GET`s, JSON body for the
  collection `POST`), length limit, 400 case, blank and normalization-empty behavior;
- matching rules with examples (substring, aliases, accents, apostrophes, punctuation) and that
  search never returns games outside the listing nor hidden entries;
- that existing filters, default categories, `orderBy` and pagination still apply and totals
  describe the filtered set;
- regenerated client: the generated `collectionsEntriesControllerFindAllByLibraryIdV1` and
  favorites functions take positional arguments, so the new `search` argument can shift `offset`
  and `limit`; check every call site after regeneration;
- client work: a debounced (~300 ms) search box on the library, favorites and collection views,
  `search` in the React Query keys, offset reset to 0 when the text changes, keeping previous data
  while loading, an empty state that distinguishes "no match" from "empty library", and
  clearing the search on library owner change;
- that client implementation is a separate change in `game-node-clients`.

## Risks / Trade-offs

- [Adding a `STORED` column rebuilds `game` (~231 MB) and `game_alternative_name` (~46 MB) with
  `ALGORITHM=COPY`; writes wait meanwhile] → Runs once in the deploy migration; IGDB sync and
  imports retry or resume. Measure the migration time on the dev database before merging and note
  it in the PR.
- [SQL and JS normalizations can drift] → Both live next to each other in comments; an integration
  test feeds the spec examples through the API against real MySQL.
- [Stored titles with decomposed accents may not match unaccented input under `LIKE`] → IGDB names
  are precomposed in practice; input decomposition is handled by the JS normalizer. Accept.
- [Very large libraries (≥20k entries) still scan every entry] → Linear and index-driven; add a
  shortcut comment with the upgrade path (id-page query or per-library index) and revisit if p95
  exceeds 200 ms.
- [Swagger positional arguments shift in the generated client] → Called out in the hand-off;
  TypeScript flags most mismatched call sites (string vs number).

## Migration Plan

1. Migration `AddGameSearchName` adds both generated columns (`up`) and drops them (`down`). No
   backfill step: MySQL computes values during the rebuild. It must pass the existing
   `migration:run` CI gate against an empty MySQL.
2. Deploy the server. Old clients never send `search` and see no change.
3. Rollback: revert the server; the extra columns are harmless and can be dropped with `down`.
