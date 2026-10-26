# Tasks

This is the functional delivery plan for the existing implementation. Continue from the workspace; do not start another rewrite. The pre-storage baseline and reusable harness are already recorded (1.1 and 1.3). Fresh-database scope removes legacy statistics conversion and offline rebuild from this plan; earlier acceptance notes are historical.

## Completion rules

- Use design section 11 as the acceptance boundary. A task is complete when its behavior is implemented, connected callers/fixtures are adapted, and the smallest relevant check plus code review supports it. Existing tests may cover several tasks; scenarios do not require separate new tests each.
- Update each checkbox when its own evidence is available. Reuse passing results until a relevant code, schema, or fixture dependency changes. Do not repeat checks for documentation-only or unrelated edits.
- Run database-mutating checks sequentially with fixture-owned cleanup. No benchmark, million-event seed, fixed-latency gate, full unrelated recovery campaign, or new test framework is required.
- Fix regressions caused by this change. Report pre-existing failures and infrastructure/tool blockers separately; do not remove a failing product case, weaken an assertion, or mark an unavailable check as passed.
- No production cutover, restore, commit, archive, or spec sync is part of implementation.

## 1. Resume from recorded evidence

- [x] 1.1 Record the integrated 76bf0a4 baseline and the pre-storage notification/build results in docs/statistics.md; completion is the existing baseline record, including its reported failures.
- [x] 1.2 Compare the current diff and recorded results with this plan; identify concrete missing behavior and invalidated checks, then record the next affected check without rerunning the baseline or all suites to rediscover known failures.
- [x] 1.3 Reuse the focused statistics commands and notification-test-harness.ts with the existing loopback-only disposable MySQL/Redis services; verify test discovery without AppModule, .env, provider credentials, or a second test stack.

## 2. Shared storage and source identity

- [x] 2.1 Complete target/state/event/total/hour/ranking entities, registration, later-ordered migrations, and unique source target FKs for all seven native source types. Verify initialized-fresh and upgraded fixtures, source/init rollback and replay preservation using the existing storage/target tests; review mappings, constraints and safe numeric IDs.
- [x] 2.2 Complete the versioned fact/metric allowlists and single writer per gauge/counter. Verify invalid input rejection and unchanged counters after replay with focused existing tests; document stores, lock order, metric meanings and the first-known-like policy in docs/statistics.md.

## 3. Committed capture

- [x] 3.1 Finish the existing applyReaction writer: engagement state, synchronous likes_current, immutable transition analytics and qualifying version-1 notification intent commit together. Preserve source-only DTOs, guards, source/context locks, three deadlock retries, committed response, numeric likeId/native subjects, and one first-like credit across relikes. Verify duplicate/concurrent requests, credit and rollback with focused reaction coverage; document the unchanged routes and transaction semantics.
- [x] 3.2 Finish durable POST /statistics/view with validated native source/viewId and authenticated lastViewedAt. Verify retry deduplication, generic binding-conflict rejection, anonymous behavior and persistence rollback with the existing view/controller tests; document accepted-impression and retry semantics.

## 4. Projection and recovery

- [x] 4.1 Complete the bounded recurring drain, atomic aggregate/completion writes, per-fact due/retry/failure state and targeted rearm, leaving likes_current synchronous. Verify duplicate processing, rollback/replay, batch bounds and a poison fact followed by valid work using focused database tests; review out-of-order discovery and stale-failure guards. Document diagnostics, retry ownership and retention without building a process-kill/outage harness.

## 5. Source reads

- [x] 5.1 Complete source summaries/status and bounded hour/day series with strict inputs, native IDs, exact UTC half-open boundaries, empty values and honest freshness/coverage. Verify boundary values and all seven source mappings with the existing small fixtures; review current access and public-field allowlists. Document range limits and response metadata.

## 6. Rankings

- [x] 6.1 Complete engagement-v1 weights, hourly decay, rolling presets, explicit intervals and disclosed version/calculation boundaries. Verify first-like credit, the half-life and invalid/conflicting ranges with small deterministic cases; document scoring precision and live-page semantics.
- [x] 6.2 Complete atomic common score publication, SQL eligibility/filters before totals/pagination, zero-score/native-ID ties, eligible review pinning and actor-aware bounded caching with current access checks. Verify these observable results on a small dataset including a matching source outside the first unfiltered page and a changed-access/actor case; review that requests do not hydrate the catalog. Document cache and refresh defaults without a latency promise.

## 7. Domain consumers and lifecycle

- [x] 7.1 Initialize comment/review/post/activity targets in their owning source transactions, preserving notification producers, update behavior, generated-activity idempotence and post-commit side effects. Verify changed creation paths with existing focused coverage and a source/init rollback case; update the lifecycle matrix.
- [x] 7.2 Extend source deletion, moderation, privacy and account cleanup under compatible locks while preserving notification invalidation. Reconcile active counts, anonymize retained actors and emit no fabricated unlike. Verify representative deletion/privacy/account behavior using existing lifecycle tests and review cascade coverage for all seven sources; document owners and inapplicable actions.
- [x] 7.3 Complete manager-scoped IGDB initialization and adapt callbacks/callers/fixtures without queued statistics work. Verify the affected imported/referenced-game rollback and replay cases, including preservation of source timestamps/counters; update the IGDB runbook. Full importer process-kill/resource campaigns are outside acceptance unless their behavior was changed.
- [x] 7.4 Read recap likes from retained actor/addition facts while preserving stored snapshots and unrelated playtime logic. Verify an addition still counts after unlike and exact period boundaries using the focused recap fixture.
- [x] 7.5 Complete the Manticore metric joins and affected schema/seeds/raw SQL, preserving sparse-game zero values, native IDs, aliases, filters/order and refresh schedule. Verify the affected engine-backed search contract using a file/name selection; update the search runbook without repeating unrelated deep-pagination/outage campaigns.

## 9. Sole API and documentation

- [x] 9.1 Finish operation-specific DTOs, OpenAPI/examples and retired-route removal for the sole source summary/status/series/ranking/view API, preserving PUT/DELETE reaction paths and response. Verify approved request/response fields and retired-route behavior with existing contract coverage and review; align docs/statistics.md and affected operations docs, including breaking frontend integration requirements.

## 10. Final acceptance

- [x] 10.1 Complete one final relevant acceptance pass: build, statistics/notification functional coverage, affected IGDB/search/recap cases, git diff --check and strict OpenSpec validation. Reuse valid earlier and overlapping results; rerun only a failing or subsequently affected selection. Record actual commands/results, remaining blockers and unmeasured capacity in docs/statistics.md. Do not run a workload or tune performance to close this task.

## Traceability from the previous plan

Tasks were consolidated and renumbered; this table preserves the previous coverage, not additional completion credit.

| Previous tasks | Current tasks |
| --- | --- |
| 1.1–1.3 | 1.1–1.3 |
| 2.1–2.4 | 2.1–2.2 |
| 3.1–3.5 | 3.1–3.2, 9.1 |
| 4.1–4.4 | 4.1 |
| 5.1–5.4 | 5.1 |
| 6.1–6.5 | 6.1–6.2 |
| 7.1–7.4 | 5.1, 6.2, 9.1 |
| 8.1–8.5 | 7.1, 7.3–7.5; legacy conversion/retirement removed for fresh-database scope |
| 9.1–9.4 | 7.2 and source/ranking access checks |
| 10.1–10.4 | Removed: no legacy statistics conversion/rebuild in fresh-database scope |
| 11.1 | 10.1 |
| 11.2 | Removed from acceptance: optional future performance exercise, only on a separate request |
