# Proposal

## Why

Per-entity counters, nullable per-source interaction relations, and request-time history aggregation make statistics expensive to extend and difficult to query by time or recency. Replace this pre-launch model locally with durable interaction facts and purpose-built projections, building on the committed reaction and notification guarantees delivered by `rebuild-notification-system`.

## What Changes

- Introduce one internal statistics target per supported entity, current user engagement state, and a typed historical event ledger; replace the five statistics tables and their per-source action foreign keys.
- Keep active-like state and its counter synchronous. Record analytics events in the same local transaction as the action, and build additive totals/hourly aggregates through recoverable, idempotent bounded processing.
- Support explicit time ranges, historical additions/removals, and versioned popularity/recency calculations. Materialize common rankings and apply eligibility and domain filters before pagination.
- **BREAKING** Replace statistics reads/status and trending payloads with source-based summaries, time-series, and a common bounded ranking contract. Replace queued view acceptance with durable view recording; remove obsolete view/init jobs after local conversion.
- Extend the existing `StatisticsService.applyReaction`, preserving `PUT/DELETE /statistics/like`, strict source-only DTOs, suspension/throttling, committed `{ isLiked, likesCount }`, source locks, and whole-transaction retries. Append analytics and the existing version-1 notification intent through the same active transaction, with correlated identities and the required numeric `likeId`; preserve existing pending delivery without rewriting its payloads.
- Reuse the implemented source/root/comment access checks and lifecycle hooks. Keep notification inbox/outbox, delivery/read state, cutover audit records, and retry/Redis configuration independent from statistics projection and rebuild.
- Update IGDB initialization, content creation/lifecycle paths, recap queries, Manticore indexing, TypeORM registration, OpenAPI, and affected fixtures together. Preserve native game/UUID identities and imported-game transaction/backpressure guarantees.
- Provide a bounded local conversion/rebuild and coordinated backup rollback after the integrated notification migrations. Separately inventory remaining view/init work: the predecessor's statistics-queue archive covers only old likes. Preserve domain records and active likes, report corrections/incomplete history, and never replay notification conversion or fabricate missing events.
- Deliver against focused functional checks on small deterministic fixtures, reusing existing coverage and valid results. Capacity benchmarking, long-running traffic generation, and a fixed projection-latency promise are outside this change's acceptance.

## Capabilities

### New Capabilities

- `engagement-statistics`: Trusted target identity, committed interaction state, durable historical facts, view deduplication, and notification-safe reaction integration.
- `statistics-projections`: Rebuildable totals and temporal aggregates, recoverable processing, source/account lifecycle, consumer integration, and local data conversion.
- `popularity-rankings`: Explicit period/recency semantics, versioned scores, eligible filtered rankings, bounded API access, and cache freshness.

### Modified Capabilities

None. The durable inventory is empty. Preserve the completed predecessor's `content-reactions`, `notification-delivery`, and `notification-inbox` requirements and the related IGDB/search contracts. Their internal storage references do not become duplicate specs here.

## Impact

- **Integrated baseline:** `rebuild-notification-system` is complete (61/61 tasks), present at commit `76bf0a4d8ec6676344e1589e0ac2ea2ed56676fd`. The predecessor wait is satisfied, and the pre-storage baseline has already been recorded in `docs/statistics.md`. Preserve that implementation and verify affected notification behavior on the replacement schema; do not repeat the baseline or unrelated predecessor acceptance work.
- Touch `src/statistics`, source entities/services, source/account cleanup, `src/recap`, IGDB create/import integration, Manticore source SQL, migrations, module exports, and statistics/search/IGDB/notification regression fixtures. Document the replacement in `docs/statistics.md` and update affected existing operations docs.
- Reuse NestJS, MySQL, Redis, BullMQ, existing transaction facilities and disposable test services. No added infrastructure or dependency.
- Out of scope: notification inbox/outbox redesign, importer outcomes and provider polling changes, new business engagement signals, frontend implementation, unique-visitor estimates, a configurable formula builder, general event infrastructure, online dual writes, production deployment, capacity certification, or an exhaustive outage/load-testing campaign.
