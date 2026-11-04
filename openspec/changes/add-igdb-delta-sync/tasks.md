# Tasks

## 1. Schema

- [ ] 1.1 Add a migration creating `game.igdbUpdatedAt` (nullable `datetime(3)`), `igdb_catalog_state.sweepEndpoint` (default `games`) and the `igdb_delta_state` table (per-stream rows plus a lease row, design D5), with matching entities; verify with `yarn test:igdb:integration` (state integration spec runs migrations against the disposable MySQL).
- [ ] 1.2 Add the character, mug-shot, gender, species and character-game join entities/tables from D9, including nullable source `igdbUpdatedAt`, optional references and unique game links; register them in the game repository module and `test/igdb/helpers/import-entities.ts`; verify migration integration tests accept a character without a game and reject duplicate links and invalid foreign keys.

## 2. Write path: recency guard, relationship policy, ownership

- [ ] 2.1 Set `igdbUpdatedAt` from the normalized IGDB `updatedAt` in `createOrUpdate`, and skip every write when the incoming value is older than the stored one (equal and null proceed), logging `catalog.game.stale_skipped`; verify with unit tests in `game-repository-create.service.spec.ts` covering older, equal, newer and null.
- [ ] 2.2 Add the `reconcileRelations` context flag that forces `processRelationships` while keeping per-relation checksum diffs; delete `shouldReconcileRelationsForGame` and the `IGDB_SYNC_RECONCILE_EVERY_RUNS` / `IGDB_SYNC_SKIP_RELATIONS_ON_CHECKSUM_MATCH` knobs; update `test/igdb/igdb-video-recovery.integration-spec.ts`; verify a unit test where only a localization checksum changed writes the localization and a no-change refresh writes no relationship rows.
- [ ] 2.3 Make `IgdbCatalogImportService.persist` / `IgdbCatalogStateService.gameTransaction` accept an injected ownership assertion (sweep or delta owner) instead of the catalog owner only, and use the same fencing for character/shared-entity transactions; verify existing runner specs still pass and lost delta ownership aborts game and character transactions before writes or checkpoints commit.
- [ ] 2.4 Implement the single character persistence path (D9): validate/normalize explicit source fields, lock and check the character's own source timestamp, diff metadata and dependencies independently, and add links to existing games without deletions or placeholders; verify unit tests for complete/optional fields, malformed input, older/equal/newer timestamps, changed mug shot with matching parent checksum, replayed links and an unavailable game.
- [ ] 2.5 Support optional character/nested relation loading through existing game reads without eager loading or new public endpoints; verify a repository integration test returns requested character, mug-shot, gender and species details and leaves unrequested characters unloaded.

## 3. IGDB client queries

- [ ] 3.1 Add the `IGDB_SYNC_ENDPOINTS` registry (design D10) with every D2/D3 endpoint in sweep order, its delta flag, owner, local entity/columns, route and compared fields (initially only `characters.games`); verify with a spec that the order matches D3, every route/owner is valid, and every `local` entity is registered.
- [ ] 3.2 Add `IgdbCatalogClient` methods for a delta window page (`where updated_at >= a & updated_at < b & id > c; sort id asc`), a sweep page (`fields id,checksum[,game]`), expanded games by ID list (≤ `batchSize`) and shared entities by ID list, with `fields` derived from the registry entry, all reusing `request()` validation (ascending IDs, limits, bounds); verify with `igdb-catalog.client.spec.ts` cases for each query string and for out-of-window/descending responses rejected as `CatalogDataError`.
- [ ] 3.3 Add explicit `/characters` delta/by-ID queries with expanded mug shot and current gender/species references (D9), `id,checksum,games` character sweep pages, and gender/species delta plus all four character endpoint sweep queries; keep character expansions within `batchSize` and reuse auth, response limits and the shared outbound budget; verify query/validation specs, including that `/games` never requests `characters.*` and no historical delta window is introduced.

## 4. Refresh routing

- [ ] 4.1 Implement routing shared by delta and sweep (design D2): game IDs → expanded fetch in `batchSize` chunks → `persist` with `reconcileRelations`; shared entities → update existing local rows only (company `parentId`, logo upsert); parent games IGDB does not return → logged no-op; verify with unit specs for each kind, including "shared entity not stored locally is not inserted".
- [ ] 4.2 Route characters to the character writer, changed mug shots through referencing local characters, and standalone gender/species rows to existing lookups only; verify routing specs show character changes do not fetch game payloads, missing referenced lookups are created by character imports, unreferenced mug shots are skipped, and character transactions do not initialize game statistics.

## 5. Delta poller

- [ ] 5.1 Implement the delta state service (fenced lease, per-stream watermark/window/cursor, pause with cooldown, seeding from last completed run `startedAt` or `now − intervalDays`); apply the same seeding to character/gender/species streams without a historical override; verify with an integration spec covering takeover fencing, normal character seeding and resume of a fixed window.
- [ ] 5.2 Implement the delta pass (registry entries with `delta`, including characters/genders/species, in sequence, fixed window = watermark − 10 min overlap to now − 60 s, ID paging, watermark advance only after an empty page, strict page backpressure, per-stream failure isolation via `runCatalogStage`) and trigger it from the scheduler tick every 5 min with no overlap; verify with `igdb-catalog-runner`-style specs: interrupted window resumes after committed cursor, failing stream keeps its watermark while others advance, ownership loss stops advancement, and character updates are imported without game timestamp changes.
- [ ] 5.3 Emit `catalog.delta.pass` / `catalog.delta.stream` structured logs (watermark lag, window, counts, duration, failure stage, no payloads); verify with a spec asserting the log fields.

## 6. Checksum sweep

- [ ] 6.1 Replace the runner's expanded page work with sweep pages iterating the registry (design D3 order, D10), comparing against local `(id, checksum[, gameId])` and each entry's compared fields (a source reference to a row absent locally is not a difference) and routing mismatches/missing via group 4; persist `sweepEndpoint` + cursor per page; move to the next endpoint on an empty page and complete after the last; skip non-IGDB `external_games` rows; route company logos via referencing local companies; verify with runner specs for: in-place cover edit refreshes parent, missing game imported, all-matching page makes no writes, a row with matching checksum but a differing compared field is refreshed, restart mid-endpoint resumes without skipping.
- [ ] 6.2 Extend the local stub IGDB fixtures (`test/igdb/helpers/*`) for delta windows and sweep pages, including character/dependency data, and update `resource-bounds` / `generated-catalog` integration specs so they assert one live page per run/pass, configured game/character/relationship limits and no queue backlog; verify with `yarn test:igdb:unit && yarn test:igdb:integration`.
- [ ] 6.3 Include all four character endpoints in the ordinary sweep after games, comparing character checksums and links to available games, with no timestamp filter or separate backfill; verify runner/integration scenarios for an old missing character imported by the scheduled sweep, a later game linked despite matching character checksum, an in-place mug-shot edit, a fully matching page making no expanded fetch/writes, and restart mid-character-page without skipped rows or duplicate links.

## 7. Docs

- [ ] 7.1 Update `docs/igdb-catalog-sync.md`: delta streams and timing constants, character fields and optional read relations, sweep endpoints and cost (character volume unmeasured), per-entity recency guards, removed env knobs, known limits (no delete propagation and delayed links to later games), and the rollback note from design Migration Plan; state that historical characters arrive through the ordinary sweep with no separate backfill action; verify the documented commands run as written.

## 8. Integration check

- [ ] 8.1 Run the full IGDB unit and integration suites plus `yarn build`, and confirm with a local stub catalog that a game made visible after a completed sweep is imported by the next delta pass, historical characters are imported by the ordinary sweep, and concurrent character sweep/delta refreshes preserve newer data and unique links.

## Workflow follow-up

- After deploy, watch `catalog.delta.stream` watermark lag catch up from 2026-10-30 21:45 and confirm IGDB 426568 appears in GameNode.
- Remove the two deleted env knobs from the production environment.
- Archive the change once the first production sweep completes.
