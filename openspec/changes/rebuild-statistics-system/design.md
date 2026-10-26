# Design

## Context

See proposal.md for motivation and the three capability specs for behavior. A design is required because this replaces persistence across several domains, changes public statistics contracts, and overlaps an active notification implementation.

Observed on 2026-10-25:

- Five concrete Statistics entities contain the same two counters. UserLike/UserView inherit five nullable statistics relations; comments add three possible source relations. Game identities are numeric; other supported source identities are UUIDs.
- StatisticsTrendingService aggregates raw interactions on reads, caches up to 50,000 game rows per period for 24 hours, applies filters afterward, and returns a fixed unfiltered total. There are no statistics-specific unit suites currently, although IGDB/search integration fixtures exercise their tables.
- handleView coerces UUID sources through parseInt. Reactions, view rows, and counters are separate writes in the inspected source. Source creation usually schedules an unawaited statistics job; posts do not initialize their own statistics on creation.
- IGDB already uses ensureGameStatistics(manager, gameId) inside the per-game transaction for imported and referenced games. Catalog replay must preserve its boundedness and counters.
- Manticore reads game_statistics directly. Recap counts surviving UserLike rows by createdAt. Posts soft-delete; other sources and profiles have cascades that currently bypass explicit counter reconciliation.
- rebuild-notification-system has complete planning artifacts and implementation work pending/in progress. Its content-reactions contract introduces committed PUT/DELETE /statistics/like, source-derived ownership, consistent locking, and transactional notification intent. Its design intentionally retains the old statistics tables and queued views/init during that change.
- During this review its persistence/relay tasks advanced. The new appendNotificationIntent(manager, intent) helper and NotificationsOutboxService.appendIntent already accept an existing manager and an explicit string intent id. ContentLikedPayload currently contains a numeric likeId; the current projector resolves native subject/root identities and does not dereference UserLike. These are live implementation observations, not a substitute for the predecessor integration gate.
- Other connection/player-import work is present in the workspace. This planning change does not edit that work or the notification artifacts.

## Goals / Non-Goals

**Goals:** Make source identity and interaction semantics reusable; preserve durable facts; keep reaction results exact; make period/recency reads efficient and explainable; replace the model locally with complete integration and measurable acceptance.

**Non-Goals:** Domain event sourcing, a shared notification/analytics event bus, a new service or database, new business engagement kinds, a formula editor, exact unique visitors, frontend implementation, live dual writes, or unmeasured production performance guarantees.

## Decisions

### 1. Apply after notification integration and preserve its ownership

Planning can proceed now. Implementation starts only after rebuild-notification-system is integrated and its reaction, producer/lifecycle, migration, and integrated-acceptance work passes. Record the integrated revision and refresh the overlap checks before editing shared files. OpenSpec does not enforce this cross-change ordering automatically; task 1.1 is a hard prerequisite for the remaining implementation tasks.

| Overlap | Notification change owns | This change does afterward |
| --- | --- | --- |
| StatisticsService and controller | Trusted synchronous reactions, strict source-only DTOs, source/root locking, response and outbox append | Replace internal engagement storage and add analytics facts in the same transaction, preserving the public reaction contract |
| Old statistics queue | Remove like commands; retain views/init for its delivery scope | Retire the remaining view/init mutations and use a dedicated statistics projection tick |
| Comment, post, activity, review creation | Notification facts, causality, rendering context and domain validation | Initialize each source's statistics target within the existing owning transaction; do not emit another notification |
| Deletion, privacy, profile cleanup | Inbox invalidation, redaction, actor representation, source/root lock order | Extend that transaction with statistics eligibility/state/counter maintenance; never replace its hooks |
| notification_outbox/event/inbox | All schemas, delivery leases, retries, groups, read versions, historical conversion | Treat them as independent stores; preserve existing rows and contracts |
| Database migration/cutover | Notification schema replacement and legacy queue capture | Allocate later migration identifiers against the integrated schema and stop/capture only obsolete statistics work |
| BullMQ Redis settings | Queue persistence, noeviction, notification transport options | Reuse infrastructure without changing notification scheduling, job payloads, retries, or cache policy |

The synchronous reaction owner generates one stable real-transition identity. Analytics uses it as a correlation/deduplication key, and the existing notification append operation receives the same qualifying event identity/facts. Neither consumer waits for the other after commit. A statistics rebuild never consumes notification_outbox and a notification retry never projects statistics.

For the currently implemented payload, keep notification intent id equal to the stable transition UUID, store analytics eventKey like:<transition UUID>, and supply the newly persisted analytics event's numeric id as likeId. That value identifies the immutable transition, not the reusable engagement_state row. Existing notification payloads keep their original likeId; global notification deduplication continues to use the string intent/event identity, so numeric IDs from the two eras need no shared namespace. Verify the integrated projector still does not require an active UserLike row before dropping it; unlike must preserve historical delivery.

The notification design's instruction to retain per-entity statistics is a boundary of that predecessor implementation, not a permanent behavior requirement. Its content-reactions/notification specs remain authoritative for reaction semantics after the storage change. Do not introduce a second reaction writer or change PUT/DELETE /statistics/like to satisfy the new schema.

Alternative rejected: combining the two ledgers or replacing the notification plan during implementation. Their populations, privacy, retention, completion, and retry responsibilities differ, and changing that foundation would conflict with work already underway.

### 2. Use one target and separate current state, facts, and projections

Keep the following stores under src/statistics, using the existing TypeORM conventions:

| Store | Key and essential data | Authority |
| --- | --- | --- |
| statistics_target | Numeric id, supported source kind, active/tombstone state | Internal target identity |
| engagement_state | Unique (targetId, profileUserId), likedAt, firstLikedAt, lastViewedAt | Current authenticated-user state and first-known-like credit admission |
| statistics_event | Numeric id, unique eventKey, version/kind, targetId, nullable actor, occurredAt, recordedAt, provenance, first-like-credit flag, projection status/attempts/due time/bounded error | Retained interaction facts; delivery metadata belongs only to the statistics projector |
| metric_total | Unique (targetId, metricCode), numeric value | Derived totals; only the reaction transaction writes likes_current |
| metric_hour | Unique (targetId, metricCode, bucketStart), numeric value | Derived additive hourly facts |
| ranking_score | Unique (rankingKey, targetId), score, definitionVersion, computedAt | Disposable prepared ranking values |
| statistics_maintenance | One bounded checkpoint/control record for conversion/rebuild and history-complete-since metadata | Restart-safe local maintenance progress and coverage, not a general workflow engine |

Add a unique statisticsTargetId FK to Game, Review, Activity, Post, ReviewComment, ActivityComment, and PostComment. Create source and target together; source upserts preserve the existing FK. Existing databases get bounded backfill before NOT NULL enforcement. There is no source-ID string coercion in hot metric joins, and public APIs continue to use native IDs.

Generic facts/state reference statistics_target through real FKs. The source-to-target FK does not automatically delete its parent when a source is deleted: lifecycle code must mark the target inactive in the owning transaction. Keep tombstones where retained facts still reference them. Typed source resolvers check the actual native source and existing access policy; an internal target is never sufficient evidence of access.

firstLikedAt survives an ordinary unlike, even if likedAt becomes null. lastViewedAt supports isViewed after rebuilding projections. Anonymous views have no engagement_state row and no durable anonymous tracking identifier. A view UUID represents one accepted navigation impression, not one person.

Use selected repository fields and small source mappings; preserve the existing layers. Adding a new supported source requires its domain FK/initializer/resolver/lifecycle coverage, not another statistics/action table. Adding an additive metric requires an allowlisted definition and projector rule. Non-additive metrics require an explicit definition rather than automatic summing.

Alternative rejected: replacing the five tables with one wide nullable source table, or putting query dimensions only in JSON. Both retain avoidable coupling or obscure indexed query predicates.

### 3. Define a small immutable fact and metric vocabulary

Initial event kinds are view.recorded, like.added, and like.removed, version 1. Initial metrics:

| Metric | Meaning and writer |
| --- | --- |
| likes_current | Exact active count, synchronously changed by reaction/account-cleanup transactions; rebuilt from engagement_state |
| views | Accepted recorded impressions, projected into totals and hourly buckets |
| likes_added | Every real like transition, including relikes; projected |
| likes_removed | Every real user unlike transition; projected |
| like_credit | First known like per actor/target; projected once for ranking |

Do not let the projector change likes_current, and do not let a synchronous view transaction increment views. Each value has one write authority. Notification eventCount, actorCount, active likes, historical additions, and ranking credit remain separate concepts.

Keep business fact fields immutable except explicit account-identity redaction. Mutable retry/completion fields are operational metadata. Store no content HTML, arbitrary URLs, credentials, private profile snapshots, raw IPs, or client-selected metric values.

For authenticated requests, derive the actor from the session. For online interactions, occurrence time comes from the server action; recordedAt identifies ledger admission. Historical conversion uses known legacy createdAt with legacy-recorded provenance and does not claim those worker-time timestamps are precise original occurrence times.

The first-known-like policy prevents accumulating ranking credit by toggling unlike/relike. It is distinct from notification semantics: every genuine relike still has a new transition and may notify under content-reactions. Legacy deleted likes cannot reveal an actor's first-ever interaction; that limitation is covered by history metadata.

Alternative rejected: ranking directly from raw like-addition traffic or defining impressions as unique people. Both would make otherwise valid aggregation misleading.

### 4. Extend the committed boundary, without another reaction implementation

Preserve the predecessor's source/root locking and bounded whole-transaction deadlock handling. Add target/state/metric locks after the source-context locks, in a consistent order. Writers, source cleanup, and notification lifecycle handlers use compatible ordering; projection workers never acquire source locks after holding aggregate locks.

For a real like/unlike, use the transaction-scoped manager to update engagement_state, change likes_current, persist the analytics event, and append the existing qualifying notification intent. Compute credit while the state transition is serialized. A duplicate requested state emits nothing. Source initialization uses the same transaction and insert-if-missing semantics. Reject injected actor/recipient/time/metric fields with operation-specific strict DTOs.

Keep notification presentation and Redis outside this transaction. Failure to append either required local intent rolls back the transition; transport/projection failure after commit does not undo it. Self/game reactions retain statistics without inventing notification recipients.

For POST /statistics/view, accept sourceType, native sourceId, and a required viewId UUID. Use eventKey view:<viewId>. Return 202 with accepted true and the same opaque event identity only after its fact and authenticated lastViewedAt commit. A duplicate key must match kind, source, and actor binding; otherwise return a generic 409. Never expose the pre-existing binding. A client reuses viewId for HTTP retries and creates another for a new navigation.

Use existing throttling and access rules. This design makes accepted-impression semantics reproducible; it does not add a fingerprinting, exact unique-visitor, or sophisticated bot-detection feature.

### 5. Project retained facts in bounded local transactions

Reuse BullMQ for one short recurring statistics drain trigger, initially every five seconds, rather than a queued payload per event. Use one transport attempt; durable database state owns finite retries. Multiple triggers are safe, queue loss is repaired by the next tick, and no domain mutation is executed by the drain.

Claim at most 200 due events per tick through short transactions and SELECT FOR UPDATE SKIP LOCKED. Process each fact's aggregate effects and completion in the same transaction, grouping writes when convenient without retaining unbounded payloads. No Redis/network operation occurs while a fact/aggregate transaction is open. Database row ownership disappears on rollback/process death, so this path needs no notification lease reuse.

Track pending/done/failed state and a bounded last error. Use five automatic attempts with finite exponential backoff; unsupported versions become visible failures. After rollback, record failure only while the event is still incomplete so another worker's successful completion cannot be overwritten. Rearm a failed event by identity after correction. Retain transport job history with bounded counts/age.

Never advance a single maximum-event-ID watermark: auto-increment allocation and commit order can differ. Completion is per fact. The event ledger itself is the durable pending source and cannot be inferred from notification delivery state.

Monitor oldest pending age, failed-event count, accepted/projected throughput, batch duration, and ranking calculation age. Use event-kind/outcome labels, not user/target/event IDs. The healthy local acceptance target is 60 seconds from commit to common ranking visibility, measured with the workload documented in section 11. Failed facts degrade freshness without blocking unrelated work.

Alternative rejected: rebuilding the entire ranking for every view, relying on transient enqueue callbacks, or multiplying queue retries and database retries without one authority.

### 6. Make temporal queries explicit and exact at their boundaries

Store UTC DATETIME(6) times and UTC hour starts. Use half-open intervals. Presets are rolling durations anchored at the response's disclosed asOf time: published computedAt for a prepared score, or one captured calculation time for an on-demand query. Return effectiveFrom/effectiveTo so a prepared result is not presented as a calculation at a later request time. Explicit calendar periods are supplied as start/end instants rather than silently equating month with calendar month.

Use complete hourly buckets for the interior of an interval and successfully projected raw facts for its partial edge hours. If start/end lie in the same hour, query that interval once. Read aggregates, boundary facts, and freshness under one consistent read transaction. Daily series group complete UTC hours into days; partial first/last segments still honor the exact requested bounds. Late facts amend their occurrence bucket after processing.

Indexes initially serve (targetId, metricCode, bucketStart) and (metricCode, bucketStart, targetId). Event indexes support due status/time/id, target/occurrence boundary reads, and actor/kind/occurrence recap reads. Verify actual plans rather than adding indexes for hypothetical dimensions.

Return calculated/asOf time, effectiveFrom/effectiveTo where applicable, projectionLagSeconds, hasFailedEvents, and historyComplete/completeSince. Lag is based on unfinished recorded work, not the maximum occurrence time seen. An old failed fact is distinguishable from missing legacy history. Initial retention keeps all facts and deduplication identities; no silent pruning is part of this local rewrite.

For a rebuild, stop statistics ingress and projection, establish exclusive database maintenance ownership, reset derived views/flows/credits/hourly/ranking data, seed likes_current from current state, and replay facts in bounded batches. Persist progress and resume after interruption. Keep notification delivery and domain mutation APIs out of the rebuild code path. A rebuild without the maintenance boundary must refuse to run.

Alternative rejected: daily-only storage, summing distinct-per-hour visitors, or declaring a rolling interval exact after rounding it to bucket boundaries.

### 7. Serve versioned weighted rankings and small pages

Initial definition engagement-v1 assigns view weight 1 and like_credit weight 5. Popular mode sums their contributions in the requested interval. Recent mode applies 2^(-ageHours/24), with a 24-hour half-life, to hourly contributions; bucketStart is the representative time. This is an explicit hourly approximation for decay, with exact count inclusion at interval edges. A content's creation/release age is not an input. Weights and half-life are code-owned and versioned, not public expression/configuration inputs.

Game and review rankings are the initial supported ranking categories. Preserve existing game criteria and mature-theme exclusion, and review game/author/excludeOwn filters. If reviewId is provided for the existing priority behavior, it is validated and pinned only when it passes the same eligibility/filter rules. Series/summary/status support all seven current source kinds.

Prepare popular day/week/month/quarter/half-year/year/all and recent week scores on a 30-second schedule. Anchor calculations to one UTC instant. Refresh one ranking key with set-based database work and atomically publish its complete replacement in a transaction; record computedAt/version on its rows. Do not publish partial per-key results. Use an index beginning with rankingKey and descending score; source-native identity supplies the final tie-break after the typed source join. Verify that final ordering's sort cost in the measured plans rather than assuming a targetId index also orders native UUIDs.

Other finite requests use hourly aggregates and exact boundary facts. Popular all-time reads additive totals; recent all-time is rejected. Default ranking is popular/week. Explicit finite intervals must be positive and at most 366 days.

All eligible source rows, including zero-score rows, participate before pagination; generic targets alone are not an eligibility source. Resolve native IDs through the appropriate source table. Apply domain filters in SQL, using existing filter-building facilities; do not load a catalog-sized ID/entity list. Count the same filtered population, and order equal scores by native source ID. Limit is 1-100 (default 20), offset is 0-10,000. These are live pages: score refreshes may move rows between requests.

Cache only bounded result pages for at most 15 seconds with normalized source/mode/window/filter/definition/actor context. Revalidate current eligibility and filtered counts before serving cached identities, including soft deletion and private collection context; discard and recompute a page whose membership no longer qualifies. A full page must not be exposed solely because its score was cached. Cache loss falls back to persisted scores/aggregates. API freshness describes this path; Manticore retains its separate existing daily refresh.

Alternative rejected: a top-N global candidate list followed by application filtering, a full-table Redis cache, arbitrary public scoring formulas, and snapshot/cursor infrastructure for a live-list contract.

### 8. Replace statistics contracts while preserving committed reactions

Use the existing application URI prefix/version. The sole supported operations after cutover are:

| Operation | Input and result |
| --- | --- |
| POST /statistics | sourceType/sourceId; summary with native identity, viewsCount, likesCount, and freshness/coverage metadata |
| GET /statistics/status | sourceType/sourceId; current isLiked/isViewed for the session actor, both false for anonymous callers |
| PUT and DELETE /statistics/like | Unchanged predecessor source-only input and exact committed isLiked/likesCount response |
| POST /statistics/view | Strict source identity and viewId; durable accepted result after commit |
| POST /statistics/series | Source identity, allowlisted additive metric, from/to, hour/day granularity; bounded source series plus freshness/coverage |
| POST /statistics/rankings | Game/review sourceType, popular/recent mode, period or from/to, source-specific filters, limit/offset; source summaries/scores, existing accurate pagination fields, definitionVersion/asOf and freshness/coverage |

Series from/to is required and bounded to 366 days. Reject raw metric paths, arbitrary orderBy/formulas, unknown fields, invalid IDs, non-integer/negative pagination, unsupported source-filter combinations, and conflicting interval selectors. Use finite allowlists of source types and metrics. Public operations expose aggregates, not actor-level events or internal target IDs.

Remove /statistics/trending/games, /statistics/trending/reviews, /statistics/queue/view, the old status statisticsId, and leftover queue/init DTOs/routes/exports after cutover. The predecessor has already removed queued likes; do not reintroduce them. Reuse the existing pagination interceptor only where its tuple/envelope fits; use operation-specific DTOs for series/metadata. Update OpenAPI and example payloads, without editing sibling frontend repositories.

### 9. Integrate lifecycle and all existing consumers

Source creation: extend the already-owned notification/content transaction to initialize targets for comments/posts/reviews/activities. Preserve notification source resolution, parent/root validation, and generated-activity idempotence. Source creation alone does not create an engagement fact.

Source deletion/access changes: add target invalidation to the predecessor's transaction and compatible lock order; inventory cascade descendants before they disappear. The projector may retain historical aggregates on tombstones, but queries and cached pages always resolve current eligible sources. Never replace notification redaction/invalidation with analytics cleanup.

Profile cleanup: collect the user's active reactions, reconcile affected likes_current values, remove their engagement_state, and anonymize actor columns on retained facts. Use bounded SQL batches within the existing coordinated cleanup boundary, preserve notification handling, and emit no fabricated user unlike events. Dead/deleted actors are not serialized publicly.

IGDB: replace ensureGameStatistics with an insert-if-missing target initializer using its supplied manager. Preserve the GameImportContext requirement, per-game transaction, forward references, checksum/reconciliation behavior, and no secondary backlog. Update the callback/type/callers and the existing tests together.

Recap: use actor/kind/occurredAt facts for totalLikesPerformed. Preserve existing persisted recap snapshots; an explicit new recap can use historical additions with coverage metadata for pre-cutover periods. Other recap/playtime/provider logic is outside scope.

Manticore: change only the source join from game_statistics to source target plus views/likes_current metric totals, with COALESCE zero defaults and original num_views/num_likes aliases. Preserve sparse games, game IDs, relevance/filter rules and the existing refresh schedule. Rebuild the index after local cutover. Update test/search's explicit schema/seeds and all raw SQL fixtures.

Review notification handler fixtures for any selected old statistics relation or causal FK assumption; native source references and immutable transition identities must continue resolving after the old statistics tables disappear. Exercise a pending pre-cutover content.liked payload and a new analytics-backed numeric likeId after UserLike removal; both must render under the existing intent identity without consulting active reaction storage. No notification store migration or public notification contract change belongs here.

### 10. Convert known local data with an honest history boundary

Use an offline local maintenance cutover. Preserve a coordinated database/code backup; stop ingress, source producers, and obsolete statistics workers. The predecessor's notification migration must already be complete. Give the new migrations identifiers later than all integrated migrations. Inspect actual FK constraints before any old statistics table/column drop.

Backfill source targets and state in bounded batches. Map surviving likes to current state and first-known-like timestamps; derive lastViewedAt from known authenticated views. Convert views and surviving like rows with deterministic keys legacy:view:<id> and legacy:like:<id>, preserving known timestamps/provenance. Counters seed from available facts/current state, not from already inconsistent legacy counters.

Record per-table counts, mapping coverage, invalid/orphan references, before/after counters, and corrections. Preserve original rows in the backup. An old counter with no corresponding facts does not justify inventing temporal events. Deleted historical likes/unlikes cannot be reconstructed. Set persistent completeSince to the cutover boundary and return incomplete-history metadata for earlier periods; a fresh empty install has no legacy gap.

Capture outstanding legacy view/init payloads before retiring workers. Valid captured views receive deterministic legacy-job identities and timestamp provenance; completed legacy jobs without a durable identity cannot be promised deduplicated against an indistinguishable historical row, so inventory ambiguity rather than double-counting silently. Initialization work only repairs targets. Never replay a legacy like job or notification operation.

Rebuild and compare projections, switch the sole API, rebuild Manticore, then drop obsolete statistics entities/action FKs and queue paths only after conversion invariants pass. A scoped local maintenance command may share checkpoint state for conversion/rebuild; do not add a general migration framework or runtime legacy fallback.

Rollback before reopening writes restores the coordinated backup and previous code with writers stopped. A down migration cannot reconstruct discarded columns or missing history. After new writes resume, restore would discard them; use a forward correction or a separate explicit recovery decision.

### 11. Verify invariants and measure the replacement

Reuse the existing disposable MySQL/Redis infrastructure and notification fixtures once integrated; do not bootstrap unrelated external providers. Add a focused statistics suite/harness with actual schema constraints, two-connection races, deterministic clock fixtures, and fault injection at transaction/projector boundaries.

Cover mixed native IDs, duplicate views, duplicate/concurrent likes and unlikes, analytics/outbox/counter rollback, game/self-like suppression, worker death, queue loss, reverse commit order, poison-event rearm, event-time edges/late arrivals, credit admission, deterministic rebuild, deletion/privacy races, profile cleanup, bounded migration restart, and unchanged notification groups/read versions after rebuild. Rerun predecessor reaction/inbox/delivery regression suites.

For a reproducible initial healthy-local workload, seed 100,000 mixed game/review targets and 1,000,000 events with a fixed skew, then admit 20 view events/second plus one reaction transition/second for five minutes alongside eight ranking readers at limits 20/100. Include a target with at least 100,000 contributions, zero-activity games, matching filters outside the old 50,000 cutoff, and long/partial-hour ranges. This is a local workload definition, not a production sizing claim.

Record event/target distributions, hardware and database versions, cold/warm p50/p95/p99 reads/writes, commit-to-projection/common-ranking delay, query plans/rows examined, process peak memory, Redis result-cache size, and worker batch limits. Require 60-second healthy-local visibility and no silent event loss/duplication. Under outage/overload, require visible lag and recovery instead. Measure competing IGDB/notification work before tuning batch sizes or adding indexes. Document outcomes in docs/statistics.md, not fabricated performance percentages.

## Risks / Trade-offs

- [Shared reaction/lifecycle files are changing concurrently] -> Apply after the notification predecessor; record its revision, keep one writer, and run its full regression contracts.
- [Extra local ledger writes add latency and source lock contention] -> Keep facts minimal, avoid I/O under locks, and measure hot-target and mixed-workload transactions.
- [Long-range sums still examine temporal rows] -> Prepare common scores, index measured paths, bound ranges, and keep cold queries out of full-history application scans.
- [A complete ranking-key refresh can contend on a large score set] -> Use set-based SQL, atomic publication and measured refresh time; introduce generation swapping only if the measured workload needs it.
- [Hourly recency is approximate] -> Document its representative timestamp and keep exact interval inclusion; finer buckets require a measured product requirement.
- [Anonymous impressions and new identities can inflate interest] -> Preserve existing rate limits, deduplicate transport retries and first-like credit, and avoid claiming unique/fraud-proof traffic.
- [Legacy counters or removed likes lack supporting facts] -> Report corrections/coverage and retain the coordinated backup; do not manufacture history.
- [An event ledger grows indefinitely] -> Retain initially for honest replay; a future retention change must explicitly preserve or narrow query/deduplication guarantees.
- [New source FKs point toward a shared target] -> Explicit source/account lifecycle maintenance and eligibility checks are mandatory; automatic reverse cascade is not assumed.

## Migration Plan

1. Complete/integrate rebuild-notification-system and record its revision and passing contracts; allocate this change's later migrations against that schema.
2. Prepare the replacement stores, writers, projections, consumers, API definitions and focused tests without a live dual-write rollout.
3. Establish local maintenance, export the coordinated backup, and inventory source/interaction counts, constraints, and legacy statistics queue payloads.
4. Run restart-safe target/state/fact conversion, record coverage/corrections, rebuild aggregates/rankings, and verify active reactions plus unchanged notification state.
5. Switch the sole statistics runtime, rebuild Manticore, verify source-based API/recap/catalog integration and mixed workload, then remove old storage and stale mutation routes.
6. Restore the coordinated backup/code if acceptance fails before writes reopen; document forward correction and data-loss implications afterward.

## References

- [CQRS in one database](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [Materialized views and rebuild trade-offs](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view)
- [Transactional outbox and independent consumers](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [MySQL composite indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
- [MySQL EXPLAIN ANALYZE](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
