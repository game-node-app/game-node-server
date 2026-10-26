# Proposal

## Why

Per-entity counters, nullable per-source interaction relations, and request-time history aggregation make statistics expensive to extend and difficult to query by time or recency. Replace this pre-launch model locally with durable interaction facts and purpose-built projections, preserving the reaction and notification guarantees being implemented in `rebuild-notification-system`.

## What Changes

- Introduce one internal statistics target per supported entity, current user engagement state, and a typed historical event ledger; replace the five statistics tables and their per-source action foreign keys.
- Keep active-like state and its counter synchronous. Record analytics events in the same local transaction as the action, and build additive totals/hourly aggregates through recoverable, idempotent bounded processing.
- Support explicit time ranges, historical additions/removals, and versioned popularity/recency calculations. Materialize common rankings and apply eligibility and domain filters before pagination.
- **BREAKING** Replace statistics reads/status and trending payloads with source-based summaries, time-series, and a common bounded ranking contract. Replace queued view acceptance with durable view recording; remove obsolete view/init jobs after local conversion.
- Preserve `PUT/DELETE /statistics/like`, their committed `{ isLiked, likesCount }` result, trusted ownership, and transactional notification intent from `rebuild-notification-system`. Reuse its real transition identity without sharing delivery state or replaying notifications during analytics recovery.
- Update IGDB initialization, content creation/lifecycle paths, recap queries, Manticore indexing, TypeORM registration, OpenAPI, and affected fixtures together. Preserve native game/UUID identities and imported-game transaction/backpressure guarantees.
- Provide a bounded local conversion/rebuild and coordinated backup rollback. Preserve domain records and active likes, report legacy counter corrections and incomplete history, and never fabricate lost unlike events or announce migrated interactions.

## Capabilities

### New Capabilities

- `engagement-statistics`: Trusted target identity, committed interaction state, durable historical facts, view deduplication, and notification-safe reaction integration.
- `statistics-projections`: Rebuildable totals and temporal aggregates, recoverable processing, source/account lifecycle, consumer integration, and local data conversion.
- `popularity-rankings`: Explicit period/recency semantics, versioned scores, eligible filtered rankings, bounded API access, and cache freshness.

### Modified Capabilities

None. The durable inventory is empty. Preserve the requirements of the in-flight `content-reactions`, `notification-delivery`, `notification-inbox`, `igdb-catalog-sync`, and search capabilities; their internal storage references do not become duplicate specs here.

## Impact

- **Implementation dependency:** complete and integrate `rebuild-notification-system` before applying this change to overlapping code. Its design deliberately retains the old statistics stores; this change supersedes that implementation afterward, without rewriting its API/delivery semantics or editing its in-flight artifacts.
- Touch `src/statistics`, source entities/services, source/account cleanup, `src/recap`, IGDB create/import integration, Manticore source SQL, migrations, module exports, and statistics/search/IGDB/notification regression fixtures. Document the replacement in `docs/statistics.md` and update affected existing operations docs.
- Reuse NestJS, MySQL, Redis, BullMQ, existing transaction facilities and disposable test services. No added infrastructure or dependency.
- Out of scope: notification inbox/outbox redesign, importer outcomes and provider polling changes, new business engagement signals, frontend implementation, unique-visitor estimates, a configurable formula builder, general event infrastructure, online dual writes, or production deployment.
