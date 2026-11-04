# Design

## Context

See proposal.md (Why). Evidence gathered on 2026-11-04 with live IGDB credentials and read-only production queries:

- Production state: last run `c917e505…` started 2026-10-30 21:45 and completed 2026-10-31 11:13 (808 min). Upper bound 426909, 385,108 games. Next run is due 2026-11-07. That works out to about 476 games/min with forced reconciliation.
- ID window 426540–426600: IGDB returns 49 games, production has 38. All 11 missing games have IGDB `updated_at` after the scan passed them (2026-11-02 to 2026-11-04). They were invisible to the API when scanned, and the ID-ascending scan never revisits IDs it has passed.
- Change volume on `games.updated_at`: 605/h, 22.9k/day, 98k/week, out of 386k games. Child/shared streams per day: external_games 752, involved_companies 329, companies 208, game_localizations 82, engines 34, keywords 16, franchises 15, platforms/genres/themes/modes/perspectives 0.
- Does a child change update the parent game's `updated_at`? Measured over the newest 500 updated rows per endpoint:
  - involved_companies: the child is updated after the game by at most 182s.
  - external_games: 42 of 107 lag by more than 1h, the worst by 29 days.
  - game_localizations: 142 of 172 lag by more than 1h, the worst by 53 days.
  - **So `games.updated_at` alone does not reflect child changes.**
- covers, screenshots, artworks, game_videos, alternative_names and company_logos have **no `updated_at`**. Newly added rows coincide with a recent parent game update (the game's ID list changes). In-place edits cannot be observed through any timestamp.
- Endpoint sizes: games 386k, covers 351k, screenshots 1.76M, artworks 273k, videos 154k, alternative names 212k, company logos 19k.
- Query `where updated_at >= a & updated_at < b & id > c; sort id asc; limit 500` works and returns rows in ascending ID order in 0.6–1.1s.
- Current code: `IgdbCatalogImportService.persist` asserts *catalog run* ownership in every game transaction. `createOrUpdate` skips relationships when the game checksum matches, except for epoch-week buckets. `Game.updatedAt` is an `@UpdateDateColumn` that the upsert happens to overwrite with IGDB's value, which makes it unreliable as a source timestamp. Relationship handlers already diff by checksum and only upsert.

## Goals / Non-Goals

**Goals:**
- New or changed IGDB data reaches GameNode within one delta interval plus the lag, typically about 5–10 minutes.
- Every stored IGDB row is compared against its source checksum at least once per sweep interval. No change can stay stale beyond that interval.
- The weekly expanded fetch of every game goes away.
- Adding a new IGDB entity or stored field later needs a registry entry and its persistence code, not changes to the poller or sweep (D9).

**Non-Goals:**
- Importing new IGDB entities (characters, edition links, regional covers). They are follow-up changes that plug into D9.
- Webhooks. The poller makes them redundant, and their delivery cannot be relied on: they deactivate after 5 failures and missed events are not redelivered.
- Propagating IGDB deletions of games or child rows. Existing behaviour already never deletes.
- Batching the refreshes that child streams trigger. Their volume (about 1.2k/day) does not justify it.
- Separate backfill jobs, commands, state or historical delta windows.

## Decisions

### D1. Delta poller with fixed windows, not an open-ended `updated_at` cursor
Each stream stores `watermark`. A pass fixes `windowStart = watermark − overlap` and `windowEnd = now − lag` and persists them. It then pages `id > cursor` within that window in ascending ID order, committing `cursor` after each page. Once the window is empty it sets `watermark = windowEnd` and clears the window.
- Overlap: 10 min, which absorbs IGDB indexing or visibility lag. Lag: 60 s. Interval: 5 min. These are fixed constants like `CATALOG_TIMING`, not env vars.
- Why: Apicalypse has one sort key, so paging by `(updated_at, id)` would need tie-breaking that the API cannot express. A fixed window paged by ID mirrors the existing upper-bound scan and inherits its recovery reasoning. Rows that change again during a pass move into a later window, and replays are idempotent through checksums.
- Alternative rejected: webhooks (see Non-Goals).

### D2. Streams and routing

| Stream | Fields fetched | Applied as |
|---|---|---|
| `games` | full `IGDB_CATALOG_FIELDS`, page = `batchSize` (25) | import game directly from the page |
| `involved_companies`, `external_games`, `game_localizations` | `id,game`, page 500 | collect distinct `game` IDs, fetch expanded in chunks of `batchSize`, import |
| `companies`, `platforms`, `genres`, `themes`, `keywords`, `franchises`, `game_engines`, `game_modes`, `player_perspectives` | the same subfields used under the game expansion, page 500 | upsert existing local rows by ID (company `parent`→`parentId`; logo upserted alongside) |

- This table and the D3 endpoint order are declared once, in the endpoint registry (D9).
- Using the expanded field list on the `games` stream avoids a second fetch for the high-volume stream.
- Standalone shared-entity routing only updates existing rows (spec: *Delta change routing*). Game imports create their dependencies.

### D3. Checksum sweep replaces the expanded full scan, reusing the runner
The existing runner, state row, lease, attempt budgets, pause/cooldown and 7/14-day schedule stay. What changes:
- State gains `sweepEndpoint`. `committedId` is the cursor within that endpoint. `upperId` is fixed per endpoint, taken at the start of each endpoint the same way as today.
- Endpoint order: `games`, `covers`, `screenshots`, `artworks`, `game_videos`, `alternative_names`, `involved_companies`, `external_games`, `game_localizations`, `company_logos`, `companies`, then the existing shared resources. Games come first so later endpoints can rely on newly imported games.
- For each page (500, `fields id,checksum[,game]` plus the entry's compared fields from D9), load local `(id, checksum[, gameId])` and the compared local values for those IDs from the matching entity in `GamePropertyPathToEntityMap`, or `Game`/`GameCompany`/`GameCompanyLogo`. Mismatched or missing entries, and entries whose compared fields differ (D9), are routed as in D2. Games missing locally are imported. Company logos have no owner field on IGDB, so they route to the local companies that reference the logo. Refreshing those companies upserts the logo; unreferenced logos are not inserted.
- `external_games`: compare only IGDB-origin rows (`origin` column).
- Cost: about 3.2M rows / 500 ≈ 6.4k requests, roughly 27 min of the shared budget, plus the expanded refreshes for mismatches. All requests use the same shared budget and bounded pages.
- Alternative rejected: keep the full scan and add the poller. That leaves the 808-minute workload in place and still cannot see hidden→visible games between scans faster than the poller already does.

### D4. One write path, ownership injected
`IgdbCatalogImportService.persist` takes an ownership assertion: sweep owner or delta owner. `gameTransaction` validates whichever owner it is given. `createOrUpdate` is unchanged in shape. It already accepts `ownershipGuard`. Shared-entity transactions use the same fenced ownership checks and commit before their page checkpoint advances.

### D5. Delta ownership and state
New table `igdb_delta_state`: one row per stream with `stream` PK, `watermark`, `windowStart`, `windowEnd`, `cursor`, `failureSummary`, `pausedUntil`, and one lease row with `ownerToken`, `ownerGeneration`, `leaseExpiresAt`. Its fencing follows `IgdbCatalogStateService` (pessimistic row lock, generation check on every mutation and game transaction). Streams run one after another within a pass, and a paused stream is skipped until `pausedUntil`. The scheduler tick (60 s) triggers a pass when 5 minutes have passed since the last pass ended. Only one pass runs at a time. A stream row is created on first use, so a stream added to the registry later needs no migration.
- Alternative rejected: a BullMQ repeatable job alone. Repeats can overlap across replicas when a pass outlasts the interval, and the queue gives no fenced watermark.

### D6. Source-recency guard
Add a nullable `game.igdbUpdatedAt` (`datetime(3)`), set from normalized `updatedAt` on every import. `createOrUpdate` reads it together with the existing locked `checksum` select. If `incoming < stored` it returns before any write and logs `catalog.game.stale_skipped`. Equal timestamps proceed (child-only changes). The `updatedAt` column keeps its current behaviour, and no other code depends on it as a source timestamp.

### D7. Relationship policy
Refresh imports set a new context flag `reconcileRelations: true`. When set, `createOrUpdate` always calls `processRelationships`. Each handler still skips writes on checksum match. `forceReconciliation` (bypass the diff) keeps its meaning and is still set for a first-ever run. `shouldReconcileRelationsForGame` and its two env knobs are deleted.

### D8. Seeding and rollout order
Streams seed their watermark from `igdb_catalog_state.startedAt` of the last completed run, otherwise `now − intervalDays`. In production that is 2026-10-30 21:45. The first games window then spans about 5 days, roughly 115k games, which at the observed rate is a few hours. This is a fixed window and resumes safely.

A stream added later uses the same rule. Its historical rows are imported by the next ordinary sweep, which traverses every endpoint from ID zero with no `updated_at` filter. No backfill process or operator action is required.

### D9. One endpoint registry with compared fields
A single constant `IGDB_SYNC_ENDPOINTS` in `src/sync/igdb/catalog/` declares every IGDB endpoint the importer tracks. The array order is the D3 sweep order. Each entry has:
- `endpoint`: IGDB endpoint name.
- `delta`: whether it is a timestamped delta stream (D2).
- `owner`: how a row reaches what gets refreshed: the source `game` field, a local column that references it (company logos → companies), or none.
- `local`: entity and columns loaded for comparison.
- `route`: `game` or `shared` (D2).
- `compare`: source fields compared with stored values besides `checksum`. Each maps to a local column or to a set of local link IDs restricted to locally available targets. Empty for every current entry.

The delta poller iterates entries with `delta`; the sweep iterates all entries; client sweep/delta queries derive `fields` from the entry. No other code lists endpoints.

A differing compared value triggers the entry's route exactly like a checksum mismatch. A source value that references a row missing locally is not a mismatch.
- Why: IGDB checksums do not change when GameNode starts storing a source field it previously ignored, so a checksum-only sweep never fills a new column or link on existing rows. With `compare`, the next ordinary sweep backfills it, consistent with D8. Example: storing `version_parent` on games later only needs `compare: ["version_parent" → versionParentId]` on the `games` entry.
- Extension: a new game-owned entity needs its entity, migration, `processRelationships` handler and one entry with `route: game`. A new independent entity (for example characters, whose game links live on `/characters`) adds one route kind with its own writer under D4 ownership and D6-style recency, plus its entries after `games`. The poller, sweep, state and client stay unchanged.
- Keep compared fields to IDs or ID lists so sweep pages stay small.
- Alternative rejected: separate endpoint lists in the client, poller and runner (they drift), and per-field backfill commands (contradicts D8).

## Risks / Trade-offs

- [In-place edits to timestamp-less entities have never been observed directly] → The sweep compares checksums of every stored row of those endpoints, so freshness is bounded by the sweep interval whatever IGDB does with timestamps.
- [IGDB `checksum` might not change on some edit] → Same assumption the current importer already relies on. There is no mitigation beyond what exists today.
- [A hidden→visible transition without an `updated_at` bump] → The games sweep imports any IGDB ID missing locally. Observed transitions bumped `updated_at` in 11 of 11 cases.
- [First delta window is large (about 115k games)] → Bounded pages, durable cursor and the shared budget. It only delays the first catch-up.
- [Sweep and delta write the same game concurrently] → Pessimistic game row lock serializes the writes. D6 rejects the older source.
- [Always reconciling relationships on refresh costs about 20 relation reads per game] → Roughly 23k games/day is about 3% of the observed import capacity.
- [Child rows deleted on IGDB stay locally] → Existing behaviour. This is a Non-Goal and is called out in the docs.
- [The IGDB `updated_at` query is slow on their side] → The poller makes a handful of requests per pass, and the latency (about 1s) is acceptable.
- [`compare` ships with no production entry] → Covered by a sweep spec using a test registry entry, so the first real use (a follow-up change) needs no sweep changes.

## Migration Plan

1. Migration: add `game.igdbUpdatedAt`, add `igdb_catalog_state.sweepEndpoint` (default `games`) and create `igdb_delta_state`. All are additive.
2. Deploy. Every delta stream seeds from the last run's `startedAt` and begins catching up. The next scheduled run (due 2026-11-07) executes as a sweep.
3. Remove `IGDB_SYNC_RECONCILE_EVERY_RUNS` / `IGDB_SYNC_SKIP_RELATIONS_ON_CHECKSUM_MATCH` from the deployment env. They are ignored if left in place.
4. Rollback: revert the code. The additive columns and table are harmless. If a sweep is mid-run on an endpoint other than `games`, its `committedId` is not a game ID. Before reverting, wait until the sweep is `completed` or reset `committedId` to 0, otherwise the old runner would skip games.
