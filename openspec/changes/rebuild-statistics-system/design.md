# Design

## Context

See proposal.md for motivation and the three capability specs for behavior. This design replaces statistics persistence while preserving the notification implementation already integrated into the repository.

Delivery revision on 2026-10-26: retain the functional contract and the implementation already in the workspace. Completion now uses the finite functional checks in section 11; the former large workload, capacity measurements, and 60-second visibility gate are removed from acceptance. This revision changes planning only and does not approve the existing implementation.

Pre-implementation baseline on 2026-10-26 at commit 76bf0a4d8ec6676344e1589e0ac2ea2ed56676fd:

- rebuild-notification-system is complete at 61/61 tasks. Its correction log records 21 suites/161 tests, build, and strict validation passing; these are predecessor results, not a fresh run for this planning update.
- Five concrete Statistics entities still contain the same two counters. UserLike/UserView inherit five nullable statistics relations; comments add three possible source relations. Games use numeric IDs; the other supported sources use UUIDs.
- StatisticsService.applyReaction already owns one local transaction for validated source locks, UserLike changes, counters, and notification intent, with at most three deadlock retries. PUT/DELETE /statistics/like, strict ReactionRequestDto, ReactionResponseDto, SuspensionGuard and ThrottlerGuard exist. There are existing controller and MySQL reaction regression suites.
- handleView still coerces UUID sources through parseInt and writes views/counters separately. Only view/create jobs remain in StatisticsQueueService/Processor; unknown jobs, including retired likes, are rejected. Comment initialization is still queued after its notification transaction; post/review/activity creation needs source/target transaction integration.
- appendNotificationIntent(manager, intent) now requires an active transaction, validates each version-1 payload and occurredAt, and inserts instead of upserting. ContentLikedPayload requires a positive safe-integer likeId and native subject/root identities. Current reactions use savedLike.id and let append generate the string notification event ID; they do not yet generate an analytics transition UUID.
- NotificationsLifecycleService and lockNotificationRoot/lockNotificationComment implement access checks, ordered source/context locking, deletion/privacy invalidation, and account cleanup. Notification projection resolves real sources without consulting active UserLike rows. Statistics must preserve those source/access semantics and extend domain transactions without replacing notification lifecycle.
- The integrated notification migration chain ends at 1792960197567-RetireLegacyNotificationStorage. notification_cutover_state/job/exclusion persist its verified conversion/audit. The statistics-queue inventory in NotificationsCutoverService deliberately archives only old like jobs; a completed notification queue checkpoint says nothing about outstanding views/create jobs.
- IGDB still initializes GameStatistics inside its per-game transaction. Manticore reads game_statistics directly; recap counts surviving UserLike rows by createdAt. Trending still aggregates history on reads, caches up to 50,000 rows per period for 24 hours, filters afterward, and reports a fixed unfiltered total.

## Goals / Non-Goals

**Goals:** Make source identity and interaction semantics reusable; preserve durable facts; keep reaction results exact; make period/recency reads bounded and explainable; complete a fresh-database implementation with focused functional evidence.

**Non-Goals:** Legacy statistics conversion or rebuild, domain event sourcing, a shared notification/analytics event bus, a new service or database, new business engagement kinds, a formula editor, exact unique visitors, frontend implementation, live dual writes, capacity benchmarking, an exhaustive fault-injection campaign, or a fixed delivery-latency guarantee.

## Decisions

### 1. Preserve the completed notification baseline

The predecessor dependency is satisfied at the reviewed revision. Task 1.1's pre-storage baseline is already recorded; reuse it rather than rerunning it after the storage replacement. Check later changes only where they affect the shared contracts. Do not repeat notification conversion or completed predecessor acceptance work.

| Shared area | Integrated behavior to preserve | Statistics adaptation |
| --- | --- | --- |
| StatisticsService and controller | applyReaction transaction/retries, strict source-only DTOs, session/suspension/throttling, source/root locks and committed response | Replace storage inside that writer and append analytics with the same manager; retain paths, DTO semantics and guards |
| Remaining statistics queue | Only view/create mutations are supported; old like commands fail | Remove obsolete view/init mutations and introduce a statistics projection trigger |
| Source creation | Comment action/notification transaction; post/review/activity persistence and existing post-commit side effects | Initialize comment targets in its current transaction; add minimal source/target transactions for the other creators, preserving notifications and other side effects |
| Deletion/privacy/profile cleanup | invalidateContent, invalidateComment, invalidateCollection and invalidateProfile plus source-context lock helpers | Add statistics updates in the same owning domain transactions; do not import StatisticsService into NotificationsModule or replace its hooks |
| Notification stores and cutover audit | Outbox/event/inbox rows, identities, payload versions, leases/retries, read versions and notification_cutover_* records | Keep schemas/data and their retry/retention authority unchanged; statistics capture/projection/retry never replays them |
| Migrations | Tracked notification DDL through 1792960197567 | Apply the fresh statistics storage and recap coverage migrations after the notification chain |
| Redis/transport | Existing BullMQ noeviction/AOF, separate cache Redis, notification attempt tokens and retry configuration | Reuse infrastructure and leave notification job/schedule/configuration behavior unchanged |

Extend applyReaction to generate a server-owned transition UUID for each real analytics transition. Store eventKey like:<UUID> or unlike:<UUID>; for a qualifying like pass that UUID as the existing notification intent id, the same occurredAt, and the newly persisted analytics event's positive safe-integer numeric id as payload.likeId. This is a new correlation step replacing savedLike.id for future likes, not an identity contract the old writer already implements. A rolled-back transaction retries as a whole; a repeated committed state returns without inserting another analytics or notification event.

Use the existing version-1 ContentLikedPayload allowlist: likeId, subjectType, subjectId, and permitted optional rootType/rootId. Preserve comment subjectType comment with the real post/review/activity root and native subject identity. Add no analytics fields to that strict payload and no new notification version/table. The append helper requires manager.queryRunner.isTransactionActive and uses insert; never call it through a default repository manager, a separate transaction, or an upsert that overwrites a prior event.

Notification IDs and numeric likeId payload values remain owned by the notification outbox. Deduplication uses the existing string event identity and recipient. A like notification remains historical after unlike. Neither asynchronous consumer waits for the other; neither derives completion from the other ledger.

The predecessor's decision to retain per-entity statistics was its implementation boundary, not a permanent behavior requirement. Its content-reactions/notification specs remain authoritative. Alternative rejected: another reaction writer, shared notification/analytics retry state, or changing the completed notification contract to accommodate analytics.

### 2. Use one target and separate current state, facts, and projections

Keep the following stores under src/statistics, using the existing TypeORM conventions:

| Store | Key and essential data | Authority |
| --- | --- | --- |
| statistics_target | Numeric id, supported source kind, active/tombstone state | Internal target identity |
| engagement_state | Unique (targetId, profileUserId), likedAt, firstLikedAt, lastViewedAt | Current authenticated-user state and first-known-like credit admission |
| statistics_event | Numeric id, unique eventKey, version/kind, targetId, nullable actor, occurredAt, recordedAt, first-like-credit flag, projection status/attempts/due time/bounded error | Retained interaction facts; delivery metadata belongs only to the statistics projector |
| metric_total | Unique (targetId, metricCode), numeric value | Derived totals; only the reaction transaction writes likes_current |
| metric_hour | Unique (targetId, metricCode, bucketStart), numeric value | Derived additive hourly facts |
| ranking_score | Unique (rankingKey, targetId), score, definitionVersion, computedAt | Disposable prepared ranking values |

Add a unique statisticsTargetId FK to Game, Review, Activity, Post, ReviewComment, ActivityComment, and PostComment. Create source and target together; source upserts preserve the existing FK. Existing sources without a target can be initialized lazily by their typed resolver. There is no source-ID string coercion in hot metric joins, and public APIs continue to use native IDs.

Generic facts/state reference statistics_target through real FKs. The source-to-target FK does not automatically delete its parent when a source is deleted: lifecycle code must mark the target inactive in the owning transaction. Keep tombstones where retained facts still reference them. Typed source resolvers check the actual native source and existing access policy; an internal target is never sufficient evidence of access.

firstLikedAt survives an ordinary unlike, even if likedAt becomes null. lastViewedAt supports isViewed without scanning historical events. Anonymous views have no engagement_state row and no durable anonymous tracking identifier. A view UUID represents one accepted navigation impression, not one person.

Use selected repository fields and small source mappings; preserve the existing layers. Adding a new supported source requires its domain FK/initializer/resolver/lifecycle coverage, not another statistics/action table. Adding an additive metric requires an allowlisted definition and projector rule. Non-additive metrics require an explicit definition rather than automatic summing.

Alternative rejected: replacing the five tables with one wide nullable source table, or putting query dimensions only in JSON. Both retain avoidable coupling or obscure indexed query predicates.

### 3. Define a small immutable fact and metric vocabulary

Initial event kinds are view.recorded, like.added, and like.removed, version 1. Initial metrics:

| Metric | Meaning and writer |
| --- | --- |
| likes_current | Exact active count, synchronously changed by reaction/account-cleanup transactions; initialized for new targets and reconciled during account cleanup |
| views | Accepted recorded impressions, projected into totals and hourly buckets |
| likes_added | Every real like transition, including relikes; projected |
| likes_removed | Every real user unlike transition; projected |
| like_credit | First known like per actor/target; projected once for ranking |

Do not let the projector change likes_current, and do not let a synchronous view transaction increment views. Each value has one write authority. Notification eventCount, actorCount, active likes, historical additions, and ranking credit remain separate concepts.

Keep business fact fields immutable except explicit account-identity redaction. Mutable retry/completion fields are operational metadata. Store no content HTML, arbitrary URLs, credentials, private profile snapshots, raw IPs, or client-selected metric values.

For authenticated requests, derive the actor from the session. Occurrence time comes from the server action; recordedAt identifies ledger admission. All facts are captured by this application; there is no historical import path or timestamp provenance field.

The first-known-like policy prevents accumulating ranking credit by toggling unlike/relike. It is distinct from notification semantics: every genuine relike still has a new transition and may notify under content-reactions.

Alternative rejected: ranking directly from raw like-addition traffic or defining impressions as unique people. Both would make otherwise valid aggregation misleading.

### 4. Extend the committed boundary, without another reaction implementation

Modify the existing applyReaction, preserving its direct game lock, lockNotificationRoot/lockNotificationComment access checks, and up to three whole-transaction deadlock retries. Those helpers enforce live post deletion, review collection visibility, activity owning context, and comment/root membership. Add target/state/metric locks after the source-context locks, in a consistent order. Writers and domain cleanup retain compatible ordering; statistics projection never acquires source locks after aggregate locks.

For a real like/unlike, use the transaction-scoped manager to update engagement_state, change likes_current, persist the analytics event, and append the existing qualifying notification intent. Compute credit while the state transition is serialized. A duplicate requested state emits nothing. Source initialization uses the same transaction and insert-if-missing semantics. Reject injected actor/recipient/time/metric fields with operation-specific strict DTOs.

Keep notification presentation and Redis outside this transaction. Failure to append either required local intent rolls back the transition; transport/projection failure after commit does not undo it. Self/game reactions retain statistics without inventing notification recipients.

For POST /statistics/view, accept sourceType, native sourceId, and a required viewId UUID. Use eventKey view:<viewId>. Return 202 with accepted true and the same opaque event identity only after its fact and authenticated lastViewedAt commit. A duplicate key must match kind, source, and actor binding; otherwise return a generic 409. Never expose the pre-existing binding. A client reuses viewId for HTTP retries and creates another for a new navigation.

Use existing throttling and access rules. This design makes accepted-impression semantics reproducible; it does not add a fingerprinting, exact unique-visitor, or sophisticated bot-detection feature.

### 5. Project retained facts in bounded local transactions

Reuse BullMQ for one short recurring statistics drain trigger, initially every five seconds, rather than a queued payload per event. Use one transport attempt; durable database state owns finite retries. Multiple triggers are safe, queue loss is repaired by the next tick, and no domain mutation is executed by the drain.

Claim at most 200 due events per tick through short transactions and SELECT FOR UPDATE SKIP LOCKED. Process each fact's aggregate effects and completion in the same transaction, grouping writes when convenient without retaining unbounded payloads. No Redis/network operation occurs while a fact/aggregate transaction is open. Database row ownership disappears on rollback/process death, so this path needs no notification lease reuse.

Track pending/done/failed state and a bounded last error. Use five automatic attempts with finite exponential backoff; unsupported versions become visible failures. After rollback, record failure only while the event is still incomplete so another worker's successful completion cannot be overwritten. Rearm a failed event by identity after correction. Retain transport job history with bounded counts/age.

Never advance a single maximum-event-ID watermark: auto-increment allocation and commit order can differ. Completion is per fact. The event ledger itself is the durable pending source and cannot be inferred from notification delivery state.

Expose oldest pending age, failed-event count, and ranking calculation age from existing durable state. Failed facts degrade freshness without blocking unrelated work. The five-second drain and six-hour score schedules are implementation defaults, not an end-to-end latency promise. A new telemetry or benchmark system is not required.

Alternative rejected: rebuilding the entire ranking for every view, relying on transient enqueue callbacks, or multiplying queue retries and database retries without one authority.

### 6. Make temporal queries explicit and exact at their boundaries

Store UTC DATETIME(6) times and UTC hour starts. Use half-open intervals. Presets are rolling durations anchored at the response's disclosed asOf time: published computedAt for a prepared score, or one captured calculation time for an on-demand query. Return effectiveFrom/effectiveTo so a prepared result is not presented as a calculation at a later request time. Explicit calendar periods are supplied as start/end instants rather than silently equating month with calendar month.

Use complete hourly buckets for the interior of an interval and successfully projected raw facts for its partial edge hours. If start/end lie in the same hour, query that interval once. Read aggregates, boundary facts, and freshness under one consistent read transaction. Daily series group complete UTC hours into days; partial first/last segments still honor the exact requested bounds. Late facts amend their occurrence bucket after processing.

Indexes initially serve (targetId, metricCode, bucketStart) and (metricCode, bucketStart, targetId). Event indexes support due status/time/id, target/occurrence boundary reads, and actor/kind/occurrence recap reads. Inspect the bounded SQL access paths during review; use EXPLAIN when investigating an observed query problem, without making a query-plan report a release gate.

Return calculated/asOf time, effectiveFrom/effectiveTo where applicable, projectionLagSeconds, hasFailedEvents, and the complete-history fields. History is complete from the fresh installation, so `completeSince` is null. Lag is based on unfinished recorded work, not the maximum occurrence time seen. Initial retention keeps all facts and deduplication identities; no silent pruning is part of this rewrite.

Alternative rejected: daily-only storage, summing distinct-per-hour visitors, or declaring a rolling interval exact after rounding it to bucket boundaries.

### 7. Serve versioned weighted rankings and small pages

Initial definition engagement-v1 assigns view weight 1 and like_credit weight 5. Popular mode sums their contributions in the requested interval. Recent mode applies 2^(-ageHours/24), with a 24-hour half-life, to hourly contributions; bucketStart is the representative time. This is an explicit hourly approximation for decay, with exact count inclusion at interval edges. A content's creation/release age is not an input. Weights and half-life are code-owned and versioned, not public expression/configuration inputs.

Game and review rankings are the initial supported ranking categories. Preserve existing game criteria and mature-theme exclusion, and review game/author/excludeOwn filters. If reviewId is provided for the existing priority behavior, it is validated and pinned only when it passes the same eligibility/filter rules. Series/summary/status support all seven current source kinds.

Prepare popular day/week/month/quarter/half-year/year/all and recent week scores every six hours, at 00:00, 06:00, 12:00 and 18:00 UTC. Anchor calculations to one UTC instant. Refresh one ranking key with set-based database work and atomically publish its complete replacement in a transaction; record computedAt/version on its rows. Do not publish partial per-key results. Use an index beginning with rankingKey and descending score; source-native identity supplies the final tie-break after the typed source join. Review that ordering explicitly; a targetId index alone does not order native UUIDs.

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

Source creation: move comment target initialization from its post-commit queue call into CommentService.create's existing action/notification transaction. ReviewsService.createOrUpdate, PostsService.create, and ActivitiesRepositoryService.create do not currently have equivalent source/target transactions; add the minimum local transaction around the actual source write and target initialization, leaving existing activity/achievement/level side effects in their current post-commit phase. Preserve notification source resolution, parent/root validation, review update behavior, and generated-activity idempotence. Source creation alone does not create an engagement fact.

Source deletion/access changes: extend the existing domain transactions that call NotificationsLifecycleService.invalidateContent, invalidateComment, invalidateCollection and invalidateProfile; retain those calls and their shared manager. Inventory source/comment/activity cascade descendants before deletion and add statistics invalidation/counter maintenance there. Preserve the effective visibility rules of lockNotificationRoot/lockNotificationComment and the notification eligibility predicates; do not copy an inbox-alias SQL string verbatim into statistics queries. Hard/soft deletion can tombstone a target; reversible privacy changes use current source eligibility and cache invalidation rather than losing its history. Keep NotificationsModule independent of statistics to avoid a reverse module dependency.

Profile cleanup: collect the user's active reactions, reconcile affected likes_current values, remove their engagement_state, and anonymize actor columns on retained facts. Use bounded SQL batches within the existing coordinated cleanup boundary, preserve notification handling, and emit no fabricated user unlike events. Dead/deleted actors are not serialized publicly.

IGDB: replace ensureGameStatistics with an insert-if-missing target initializer using its supplied manager. Preserve the GameImportContext requirement, per-game transaction, forward references, checksum/reconciliation behavior, and no secondary backlog. Update the callback/type/callers and the existing tests together.

Recap: use actor/kind/occurredAt facts for totalLikesPerformed. Preserve existing persisted recap snapshots; new recaps use retained additions from the beginning of statistics capture. Other recap/playtime/provider logic is outside scope.

Manticore: change only the source join from game_statistics to source target plus views/likes_current metric totals, with COALESCE zero defaults and original num_views/num_likes aliases. Preserve sparse games, game IDs, relevance/filter rules and the existing refresh schedule. Update test/search's explicit schema/seeds and all raw SQL fixtures.

Review notification handler fixtures for any selected old statistics relation or causal FK assumption; native source references and immutable transition identities must continue resolving independently of statistics storage. No notification store migration or public notification contract change belongs here.

### 10. Start with a fresh statistics store

This implementation assumes statistics begin with a fresh database. Apply the statistics storage migration and recap coverage migration in the normal application migration chain. Do not inventory or import old statistics rows or queue jobs, create a conversion checkpoint, or run a one-time aggregate rebuild.

Source creation initializes its statistics target inside the owning source transaction. Existing sources that do not yet have a target can be initialized by the typed source resolver before a statistics operation. New facts begin at installation and are projected by the normal recurring worker; ranking scores refresh on their regular schedule. History coverage is complete from this starting point.

Keep notification_outbox, notification_event, notification_inbox and notification_cutover_state/job/exclusion independent. Statistics capture, projection and retry never modify notification IDs, payloads, read state, or audit records.

### 11. Finish with finite functional acceptance

Complete missing behavior in the current implementation before expanding tests or tooling. Reuse test/notifications/notification-test-harness.ts and the existing disposable MySQL/Redis services without AppModule, .env, or provider credentials. Preserve the loopback-only igdb_sync_test validation. Run database-mutating suites sequentially, with fixture-owned setup and cleanup; never run a workload or destructive fixture alongside another user of that database. Stop runners left by an interrupted invocation before restarting it.

Use small deterministic fixtures. Add rows beyond a page or batch limit only when that limit is the behavior being checked; do not seed a catalog to prove SQL filtering. The scenarios in the specs describe behavior, not a requirement for one new test per scenario, source, failure point, or interleaving. Existing tests can cover several requirements. Add a focused test only for new non-trivial logic or a concrete uncovered risk; do not test TypeScript guarantees, mirror private SQL, or mock away the failure under examination.

| Area | Sufficient functional evidence |
| --- | --- |
| Capture | Native numeric/UUID identities, strict access/inputs, a retry-stable view, like/unlike/relike credit, one real concurrent reaction case, and an injected persistence failure that proves transaction rollback. Preserve notification identity/payload behavior. |
| Projection and reads | Duplicate processing has one aggregate effect; a failed fact can be rearmed without blocking valid work; intervals, first-like weights, and zero/lag/coverage responses have the expected values. Exercise rollback/replay through database transactions rather than building a process-kill or network-outage harness. |
| Rankings and lifecycle | A small filtered/paginated dataset includes low-score matches, zero scores and an ineligible source; current privacy and actor context are respected. Check changed creation/cleanup paths using existing lifecycle coverage and a representative rollback/account-cleanup fixture. Review the mappings for all seven sources. |
| Consumers | Run the affected IGDB import/rollback/replay cases, one engine-backed search contract covering the replacement popularity join, and the recap history case. Full catalog recovery, resource-bound, provider, and search outage campaigns are not required unless changes touch their behavior or reveal a regression. |

During implementation, run the smallest affected test selection after a meaningful change. After a failure, diagnose it, make a concrete correction, and rerun that selection. A passing result remains valid until a later change affects its code, schema, or fixture dependencies; edits to unrelated files or documentation do not invalidate it. Mark the corresponding task immediately using that evidence, rather than waiting for every suite to pass.

The final acceptance pass consists of the build, statistics/notification functional coverage, the affected IGDB/search/recap cases above, git diff --check, and OpenSpec validation. Use the existing commands (yarn build, yarn test:statistics, yarn test:notifications) and Jest file/name selections with the existing integration configs. Reuse overlapping valid results. Run each still-needed check once against the final relevant code, then rerun only failures or checks invalidated by a subsequent correction. Report pre-existing failures and unavailable checks separately; a new regression still requires a fix and an unavailable check is not a pass.

If a provider/tool or fixture-startup operation fails twice without a new corrective action, stop that operation and report the concrete blocker. Do not keep submitting identical requests, rerun a full suite to rediscover the same error, or change product behavior to satisfy a contaminated fixture.

Acceptance ends when the functional tasks are supported by code review and the checks above, or a specific blocker is reported. Record concise commands/results and remaining limitations in docs/statistics.md. Load generation, million-event seeding, cold/warm latency percentiles, hardware inventories, memory/cache measurements, query-plan reports, competing-workload tuning, and an exhaustive outage matrix are optional future performance work and MUST NOT block or be run automatically for this change. Existing workload code is not an acceptance dependency. No production-capacity or fixed-latency claim is made.

## Risks / Trade-offs

- [Statistics storage replacement can regress completed reaction/lifecycle behavior] -> Use the recorded integrated revision, extend its one writer/hooks, and rerun existing notification/reaction contracts on the replacement schema.
- [Extra local ledger writes add latency and source lock contention] -> Keep facts minimal and avoid I/O under locks; investigate observed contention without making capacity tuning part of functional delivery.
- [Long-range sums still examine temporal rows] -> Prepare common scores, index measured paths, bound ranges, and keep cold queries out of full-history application scans.
- [A complete ranking-key refresh can contend on a large score set] -> Use set-based SQL and atomic publication; generation swapping or capacity tuning requires a separately observed need.
- [Production capacity remains unmeasured] -> Keep batch/page bounds and freshness metadata, disclose the limit, and schedule a separate performance exercise only when requested.
- [Hourly recency is approximate] -> Document its representative timestamp and keep exact interval inclusion; finer buckets require a measured product requirement.
- [Anonymous impressions and new identities can inflate interest] -> Preserve existing rate limits, deduplicate transport retries and first-like credit, and avoid claiming unique/fraud-proof traffic.
- [The application starts without historical statistics facts] -> Scope this implementation to a fresh statistics database; no legacy history import is provided.
- [An event ledger grows indefinitely] -> Retain initially for honest replay; a future retention change must explicitly preserve or narrow query/deduplication guarantees.
- [New source FKs point toward a shared target] -> Explicit source/account lifecycle maintenance and eligibility checks are mandatory; automatic reverse cascade is not assumed.

## Migration Plan

1. Apply the statistics storage and recap coverage migrations after the integrated notification migration chain.
2. Start the application with statistics capture, projection, and ranking refresh enabled. No old statistics data or queue work is imported.
3. Rebuild the search index through the regular deployment process if the search template changed.

## References

- [CQRS in one database](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [Materialized views and rebuild trade-offs](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view)
- [Transactional outbox and independent consumers](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [BullMQ idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [MySQL composite indexes](https://dev.mysql.com/doc/refman/8.4/en/multiple-column-indexes.html)
- [MySQL EXPLAIN ANALYZE](https://dev.mysql.com/doc/refman/8.4/en/explain.html)
