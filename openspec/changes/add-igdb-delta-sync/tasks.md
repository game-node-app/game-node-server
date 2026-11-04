# Tasks

## 1. Schema

- [x] 1.1 Add a migration creating `game.igdbUpdatedAt` (nullable `datetime(3)`), `igdb_catalog_state.sweepEndpoint` (default `games`) and the `igdb_delta_state` table (per-stream rows plus a lease row, design D5), with matching entities; verify with `yarn test:igdb:integration` (state integration spec runs migrations against the disposable MySQL).

## 2. Write path: recency guard, relationship policy, ownership

- [x] 2.1 Set `igdbUpdatedAt` from the normalized IGDB `updatedAt` in `createOrUpdate`, and skip every write when the incoming value is older than the stored one (equal and null proceed), logging `catalog.game.stale_skipped`; verify with unit tests in `game-repository-create.service.spec.ts` covering older, equal, newer and null.
- [x] 2.2 Add the `reconcileRelations` context flag that forces `processRelationships` while keeping per-relation checksum diffs; delete `shouldReconcileRelationsForGame` and the `IGDB_SYNC_RECONCILE_EVERY_RUNS` / `IGDB_SYNC_SKIP_RELATIONS_ON_CHECKSUM_MATCH` knobs; update `test/igdb/igdb-video-recovery.integration-spec.ts`; verify a unit test where only a localization checksum changed writes the localization and a no-change refresh writes no relationship rows.
- [x] 2.3 Make `IgdbCatalogImportService.persist` / `IgdbCatalogStateService.gameTransaction` accept an injected ownership assertion (sweep or delta owner) instead of the catalog owner only, and use the same fencing for shared-entity transactions; verify existing runner specs still pass and lost delta ownership aborts game and shared-entity transactions before writes or checkpoints commit.

## 3. Endpoint registry and IGDB client queries

- [x] 3.1 Add the `IGDB_SYNC_ENDPOINTS` registry (design D9) with every D2/D3 endpoint in sweep order, its delta flag, owner, local entity/columns, route (`game` or `shared`) and an empty `compare` list; verify with a spec that the order matches D3, every route/owner is valid, and every `local` entity is registered.
- [x] 3.2 Add `IgdbCatalogClient` methods for a delta window page (`where updated_at >= a & updated_at < b & id > c; sort id asc`), a sweep page (`fields id,checksum[,game]` plus compared fields), expanded games by ID list (≤ `batchSize`) and shared entities by ID list, with `fields` derived from the registry entry, all reusing `request()` validation (ascending IDs, limits, bounds); verify with `igdb-catalog.client.spec.ts` cases for each query string and for out-of-window/descending responses rejected as `CatalogDataError`.

## 4. Refresh routing

- [x] 4.1 Implement routing shared by delta and sweep (design D2), dispatched by the registry `route`: game IDs → expanded fetch in `batchSize` chunks → `persist` with `reconcileRelations`; shared entities → update existing local rows only (company `parentId`, logo upsert); parent games IGDB does not return → logged no-op; verify with unit specs for each route, including "shared entity not stored locally is not inserted".
- [x] 4.2 Skip invalid entries and non-transient TypeORM `QueryFailedError`s in shared game persistence, logging game ID/reason/code so delta and sweep advance; preserve throws for transient and other errors; verify continuation, transient and unexpected failures, and update the routing spec, design risk and docs.

## 5. Delta poller

- [x] 5.1 Implement the delta state service (fenced lease, per-stream watermark/window/cursor created on first use, pause with cooldown, seeding from most recent run `startedAt` (completed or in progress), or `now − intervalDays` when null); verify with an integration spec covering takeover fencing, seeding (including an ongoing sweep starting the window at its `startedAt` minus overlap) and resume of a fixed window.
- [x] 5.2 Implement the delta pass (registry entries with `delta`, in sequence, fixed window = watermark − 10 min overlap to now − 60 s, ID paging, watermark advance only after an empty page, strict page backpressure, per-stream failure isolation via `runCatalogStage`) and trigger it from the scheduler tick every 5 min with no overlap; verify with `igdb-catalog-runner`-style specs: interrupted window resumes after committed cursor, failing stream keeps its watermark while others advance, ownership loss stops advancement.
- [x] 5.3 Emit `catalog.delta.pass` / `catalog.delta.stream` structured logs (watermark lag, window, counts, duration, failure stage, no payloads); verify with a spec asserting the log fields.

## 6. Checksum sweep

- [x] 6.1 Replace the runner's expanded page work with sweep pages iterating the registry (design D3 order, D9), comparing against local `(id, checksum[, gameId])` and each entry's compared fields (a source reference to a row absent locally is not a difference) and routing mismatches/missing via group 4; persist `sweepEndpoint` + cursor per page; move to the next endpoint on an empty page and complete after the last; skip non-IGDB `external_games` rows; route company logos via referencing local companies; verify with runner specs for: in-place cover edit refreshes parent, missing game imported, all-matching page makes no writes, a test registry entry with a compared field refreshes a row whose checksum matches but whose stored value differs, restart mid-endpoint resumes without skipping.
- [x] 6.2 Extend the local stub IGDB fixtures (`test/igdb/helpers/*`) for delta windows and sweep pages, and update `resource-bounds` / `generated-catalog` integration specs so they assert one live page per run/pass, configured game/relationship limits and no queue backlog; verify with `yarn test:igdb:unit && yarn test:igdb:integration`.

## 7. Docs

- [x] 7.1 Update `docs/igdb-catalog-sync.md`: delta streams and timing constants, the endpoint registry and how to add an endpoint or compared field, sweep endpoints and cost, the recency guard, removed env knobs, known limits (no delete propagation), and the rollback note from design Migration Plan; verify the documented commands run as written.

## 8. Integration check

- [x] 8.1 Run the full IGDB unit and integration suites plus `yarn build`, and confirm with a local stub catalog that a game made visible after a completed sweep is imported by the next delta pass, and concurrent sweep/delta refreshes of the same game preserve the newer data.

## Workflow follow-up

- After deploy, watch `catalog.delta.stream` watermark lag catch up from 2026-10-30 21:45 and confirm IGDB 426568 appears in GameNode.
- Remove the two deleted env knobs from the production environment.
- Archive the change once the first production sweep completes.
- Propose character imports as a separate change on top of the registry (D9 Extension).
