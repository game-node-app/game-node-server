# Tasks

All implementation tasks depend on 1.1. Planning is complete independently of predecessor implementation; an unchecked 1.1 forbids changing overlapping runtime code or running the statistics cutover.

## 1. Predecessor integration and contract baseline

- [ ] 1.1 Verify rebuild-notification-system is implemented and integrated, including its reaction, source lifecycle, conversion, and integrated acceptance tasks; record its revision and passing reaction/inbox/delivery checks in docs/statistics.md, and do not proceed while that prerequisite is missing.
- [ ] 1.2 Capture the integrated reaction routes/strict DTOs, transaction-scoped notification append contract, transition identity/numeric likeId semantics, source lock order, deletion hooks, migrations, and queue options; verify the design overlap table still matches them and add regression fixtures for the unchanged committed reaction response and notification history/read state.
- [ ] 1.3 Add focused statistics unit/integration commands and a disposable test module using existing MySQL/Redis infrastructure; verify discovery includes tests outside src where needed and starts without AppModule, provider credentials, or changes to unrelated connection/import work.

## 2. Shared persistence and source identity

- [ ] 2.1 Add target, engagement state, event ledger, metric totals/hourly values, ranking scores, and bounded maintenance checkpoint entities plus TypeORM registration and later-ordered additive migrations; verify fresh migration, uniqueness, FKs, due-event indexes, metric access indexes, and safe numeric/native-ID handling on MySQL.
- [ ] 2.2 Add the unique statistics target FK to all seven existing source types and transaction-scoped insert-if-missing initialization; verify creation rollback, duplicate initialization, source-kind consistency, and preservation of existing targets/counters on replay.
- [ ] 2.3 Define versioned fact/metric allowlists and one write authority per gauge/counter; verify unknown types/versions, unsupported metric values, and unbounded/private payload fields fail validation before persistence.
- [ ] 2.4 Document the stores, source FK direction, metric semantics, lock order, and first-known-like policy in docs/statistics.md; verify examples distinguish active likes, historical transitions, credit, and notification counts.

## 3. Committed engagement capture

- [ ] 3.1 Adapt the predecessor's single reaction writer to engagement_state and likes_current while adding a correlated analytics fact to its existing transaction; verify duplicate/concurrent likes and unlikes, missing-state initialization, non-negative counts, and notification id/likeId correlation with two MySQL connections.
- [ ] 3.2 Preserve trusted source/session ownership, strict source-only reaction inputs, existing suspension/throttling checks, and PUT/DELETE /statistics/like responses; verify forged recipient/actor fields, inaccessible targets, game/self-likes, and analytics/outbox/counter failures using predecessor contract tests and injected rollbacks.
- [ ] 3.3 Persist firstLikedAt across ordinary unlikes and award one first-known-like credit; verify like/unlike/relike produces two additions, one removal, one active like, one credit, and the predecessor's distinct notification transition identities.
- [ ] 3.4 Add durable POST /statistics/view with source validation and required retry-stable viewId; verify UUID sources, anonymous/authenticated views, concurrent duplicate IDs, binding conflicts, lost acknowledgements, persistence failure, and lastViewedAt using real constraints.
- [ ] 3.5 Document view impression/retry semantics, transaction durability, actor privacy, and reaction examples in docs/statistics.md and OpenAPI; verify examples contain no client-controlled routing, times, or metric weights.

## 4. Bounded projection and recovery

- [ ] 4.1 Add the recurring bounded statistics drain trigger and transaction-scoped event projection/completion, with explicit transport options; verify concurrent workers, failure before commit, acknowledgement loss, queue loss, reverse commit order, and bounded admitted events without per-event queue backlog.
- [ ] 4.2 Add finite durable retry/due state, diagnosable failed events, guarded failure updates, and targeted rearm; verify poison events do not block valid work and a stale failure cannot overwrite another worker's completed effect.
- [ ] 4.3 Project views, additions, removals, and credit into totals/hour buckets while leaving likes_current exclusively synchronous; verify duplicate replay and late occurrence times produce the expected exact values.
- [ ] 4.4 Add bounded diagnostics and recovery/retention instructions to docs/statistics.md; verify pending age, failed counts, actual queue retention, and rearm behavior without secrets, identity-valued metric labels, or notification mutation.

## 5. Temporal reads and maintenance rebuild

- [ ] 5.1 Implement source summaries and exact half-open interval reads using complete hours and projected boundary facts; verify exact endpoints, same-hour ranges, partial days, UTC normalization, empty sources, late facts, and no double-counted edge bucket.
- [ ] 5.2 Add bounded hour/day series and freshness/coverage metadata from durable state; verify historical gaps, failed/pending events, maximum ranges, and no false completeness inferred from maximum event IDs/times.
- [ ] 5.3 Add exclusive restart-safe maintenance rebuild from facts and current state; verify incremental/rebuilt equivalence, repeated/interrupted runs, active-write refusal, and byte-for-byte unchanged notification event/group/read data for a paused notification fixture.
- [ ] 5.4 Document range, bucket, coverage, rebuild ownership, and retained-fact guarantees in docs/statistics.md; verify the documented commands reject missing maintenance prerequisites and run on disposable services without replaying domain actions.

## 6. Popularity and recency queries

- [ ] 6.1 Implement engagement-v1 period and hourly-decayed scores with code-owned weights/half-life; verify preset durations, explicit selectors, old-source/new-interest behavior, the half-life calculation, first-like credit, zero scores, and rejected unbounded recent ranges.
- [ ] 6.2 Prepare the common game/review score keys with atomic per-key publication and bounded scheduling; verify no partial score set becomes visible, ties follow the documented source ordering, and request memory does not grow with the catalog.
- [ ] 6.3 Apply game criteria/mature exclusion and review game/author/exclude-own/pinning policies before pagination and totals; verify selective matches beyond the former 50,000 cutoff, inaccessible pinned reviews, accurate empty/last pages, and live refresh semantics.
- [ ] 6.4 Add short page caching with normalized definition/filter/actor context and current eligibility/count checks; verify cache eviction, two actors' exclude-own requests, deletion/privacy changes between calculation and serving, and bounded result payloads.
- [ ] 6.5 Document scoring, hourly decay precision, presets/explicit intervals, live pages, cache freshness, and the measured-index strategy in docs/statistics.md; verify representative SQL plans use intended access paths without full-catalog application filtering.

## 7. Sole statistics API and contract cleanup

- [ ] 7.1 Replace summaries/status with native-source DTOs and expose series/common rankings using operation-specific validation and existing pagination conventions; verify limits/offsets, unsupported fields/filters/metrics, raw expressions, malformed IDs, and public responses without user-event data/internal target IDs.
- [ ] 7.2 Refresh OpenAPI and request/response contract fixtures for every operation, preserving committed reaction routes exactly; verify examples include effective intervals/freshness/coverage and cover all seven summary/status source kinds.
- [ ] 7.3 Remove obsolete trending operations, statisticsId status input, remaining queued view/init operations and unused payload/response DTOs after the migration boundary; verify retired routes cannot mutate state and no legacy adapter or duplicate reaction path remains.
- [ ] 7.4 Document the sole replacement API, breaking frontend integration requirements, errors, pagination, and accepted-view semantics in docs/statistics.md; verify examples agree with contract tests without editing sibling frontend code.

## 8. Domain consumers and import/search regressions

- [ ] 8.1 Initialize targets in the owning comment, review, post, and activity creation transactions while preserving the integrated notification producers/validation; verify source/init rollback, duplicate generated activities, and no extra notification or engagement from source creation.
- [ ] 8.2 Replace ensureGameStatistics and its import-context callback/callers with manager-scoped target initialization; update IGDB fixtures and verify imported/referenced-game rollback, replay preservation, forward references, bounded checkpoints, and no statistics-job accumulation.
- [ ] 8.3 Replace recap's active-UserLike period count with retained actor/addition facts and coverage metadata; verify unlike-before-recap, exact period bounds, partial legacy history, and unchanged existing recap snapshots and unrelated playtime calculations.
- [ ] 8.4 Change Manticore source joins/aliases and the explicit search schema/seeds/raw SQL fixtures; verify sparse-game zero popularity, native IDs, relevance/filter/tie behavior, manual rebuild, and the unchanged refresh schedule in existing search integration suites.
- [ ] 8.5 Update IGDB/search/recap operations documentation for the new storage and history boundary; verify old table/helper references are absent from active runtime/docs except intentional migration material.

## 9. Source deletion account cleanup and access

- [ ] 9.1 Extend the predecessor's hard/soft deletion, moderation, collection privacy, and cascade-descendant handling with target invalidation under compatible locks; verify two-connection delete/project/read races preserve both statistics eligibility and notification redaction.
- [ ] 9.2 Reconcile active counts and remove engagement state during account cleanup while anonymizing retained actor facts; verify correct remaining counts, no fabricated unlike events, no exposed deleted identity, and unchanged notification cleanup guarantees.
- [ ] 9.3 Revalidate all supported source kinds at public summary/status/series/ranking reads, including cached pages; verify deleted/private roots and missing actors do not leak identities, scores, protected context, or totals.
- [ ] 9.4 Document a lifecycle matrix in docs/statistics.md with every source kind and account cleanup owner; verify each path has a regression fixture or an explicitly inapplicable action rather than relying on reverse FK cascades.

## 10. Local conversion and destructive cleanup

- [ ] 10.1 Add a bounded checkpointed conversion for source targets, active state, known views and surviving like facts using deterministic legacy identities; verify restart, duplicate batches, UUID/native mappings, legacy timestamps/provenance, invalid-reference inventories, and no notification replay.
- [ ] 10.2 Inventory legacy counters and pending/failed view/init payloads, report before/after corrections and ambiguous work, and persist completeSince coverage; verify no missing history is fabricated, domain records/active likes remain intact, and stale queued like handlers are never invoked.
- [ ] 10.3 After conversion/rebuild checks, enforce final source constraints and remove old statistics/action tables, FKs, registrations, queue modules, helper exports, and stale fixtures; verify pending old and new content.liked payloads still render without UserLike lookup, fresh/upgraded fixtures start, and repository-wide searches find no live legacy consumers.
- [ ] 10.4 Document and exercise the offline cutover, coordinated backup restore, queue capture, Manticore rebuild, counts/coverage report, and rollback limits in docs/statistics.md; verify rerunning the procedure is safe and post-resume restore is not represented as lossless.

## 11. Integrated acceptance and measured limits

- [ ] 11.1 Run the focused unit/contract suites, disposable statistics/notification/IGDB/search integration checks, project build, and affected repository checks; resolve caller/schema/export regressions and record commands/results with unchanged notification read/delivery contracts.
- [ ] 11.2 Run the documented 100,000-target/1,000,000-event healthy-local workload and skewed/filter-boundary cases, then outage/overload recovery; record cold/warm latency percentiles, query plans/work, peak memory, cache size, admitted batch bounds, and 60-second healthy-local visibility in docs/statistics.md without claiming production capacity.
