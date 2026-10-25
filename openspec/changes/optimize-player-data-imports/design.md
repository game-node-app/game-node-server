# Design

## Context

See `proposal.md` for motivation and capability boundaries. This is a cross-service reliability and performance change, so a design is required.

### Observed implementation

- `PlaytimeWatchService` scans every library and connection at 00:00, 06:00, 12:00, and 18:00. `ImporterWatchService` uses a process-relative 24-hour interval. Both materialize the complete population.
- `registerJob` does not await or return the queue write. WebSocket refresh and connection creation call it; a failed enqueue can therefore appear successful.
- The installed `@nestjs/bullmq` 11.0.2 merges queue options shallowly. Local `defaultJobOptions` in importer and achievement modules replace global removal options. Importer jobs have stable IDs and can remain completed forever; achievement jobs have generated IDs and can accumulate.
- Each mapped playtime entry schedules achievements. The old-game skip in `GameAchievementSyncProcessor` is commented out, and the queue-service constructor schedules one hard-coded PSN user/game.
- Achievement processing fetches obtained data, persists it, then re-enters provider-backed reads to update completion. Activity generation fetches the catalogue again. HTTP v2 reads also persist asynchronously; journal reads use the same provider-backed path.
- Achievement rows can commit before completion/activity failure. A retry then sees no new achievements and can omit the activity. Activity publication currently follows a separate queue write.
- Xbox batching overlaps one item and does not advance after empty statistics. PSN trophy-title pagination derives offsets from totals rather than returned pages and never sets its assumed page limit.
- PSN library/title fetchers catch errors and return partial arrays, which normal cache decorators can cache as successful values. PSN mappings are matched by name and later reduced using only service name.
- Playtime processing reads each existing row before `save`, which reads it again. PSN/Xbox recent-time calculation can aggregate all games repeatedly with a different end timestamp per invocation.
- The age expression compares `updatedAt.diff(now) < 14`, so an old record also passes. History uses lifetime `MAX - MIN` filtered by played dates rather than observation boundaries; polling changes Steam/Xbox inferred play counts.
- The importer throws 404 for no unprocessed entries while its worker expects an empty result. Notification state can prevent retrying failed automatic imports.

The queue-option replacement, negative-age comparison, and repeated PSN offset were reproduced with read-only checks. Production load, provider quotas, and database query plans were not measured. No percentage savings is asserted.

## Goals / Non-Goals

**Goals:** Preserve imported data through failures, make recurring work restart-safe, reduce provider and database work per successful cycle, and define explicit observation semantics before lowering frequency.

**Non-Goals:** Billing, paid entitlements, premium cadence activation, additional providers, exact historical session reconstruction, a generic workflow engine, a replacement queue/cache stack, destructive history rewriting, and increasing worker concurrency as a first optimization.

## Decisions

### 1. Daily admission is persistent; scheduler ticks are cheap

Use a 24-hour default full-refresh interval for every connection, rather than encoding product cadence in four cron timestamps. A short scheduler tick (proposed five minutes) queries indexed due connection rows in pages of 100; it does not fetch every library. Import discovery and playtime can share a complete provider-library snapshot but retain separate success markers because one can fail independently.

Persist connection-scoped success/next-due times, retry eligibility, current account identity, and a bounded admission lease. Use atomic database admission and deterministic pending job identities so competing API instances cannot schedule the same work. Do not hold a database transaction during provider I/O. Enqueue failures release admission or leave an expiring reservation; process death must not strand the connection. Compare an owner token/account identity when committing success so an expired worker cannot overwrite newer state.

Successful full refreshes set their next eligibility 24 hours later. Transient failures use bounded retry delays and do not consume a successful daily refresh. Retry delay is at least any provider Retry-After value exposed by the client; PSN HTTP Retry-After is unavailable through the retained library. A private/unavailable account retains existing data and gets a delayed, visible failure rather than immediate repeated work.

First synchronization of a newly linked provider account is immediate. Bootstrap existing accounts across a deterministic 24-hour spread instead of scheduling the entire population immediately. Changing only auto-import settings must not reset eligibility; changing `sourceUserId` invalidates account-bound state. Jobs carry the connection ID and source-account identity and recheck both before persistence. Disconnected/replaced jobs become harmless terminal skips.

Alternative rejected: changing the cron expression alone, because it neither survives application restarts correctly for importer discovery nor limits manual/live-read work.

### 2. Admission covers every source of provider work

Keep connection-wide admission for full scans and user/game admission for targeted achievement refreshes. Both automatic and explicit manual full scans share the same connection cooldown; public reads cannot bypass user/game cooldown by selecting another route. A successful full-scan achievement fetch advances that game's same freshness state. Targeted refreshes are also limited to one successful refresh per 24 hours by default, except retrying failed work or completing initial import.

Achievement GET and journal paths return persisted obtained results; if stale or missing, they can request one deduplicated eligible background refresh. They never directly fetch and asynchronously persist a second copy of provider state. Preserve existing result shapes; expose additive freshness/pending/next-eligible information through the existing synchronization surface where clients need it. An empty initial response must be distinguishable from a successful empty sync through that status surface. Validate requested sources and authorization at ingress and again validate connection ownership in the worker.

Keep interval selection in one small policy boundary using the current daily constant. No entitlement table, paid tier, configurable policy framework, or billing integration is introduced. Existing provider caches remain useful; later premium cadence work must explicitly revisit TTLs.

### 3. Queue lifecycle is explicit and bounded

Each affected queue defines its effective retention rather than relying on nested global inheritance. Proposed bounds: successful jobs retained up to one hour/1,000 entries and failures up to seven days/1,000 entries. Because bounded completed retention still blocks reused IDs, use attempt/run-specific job IDs with stable admission state or active-work deduplication; do not reuse one permanent importer ID. Match the mechanism to the installed BullMQ version and test effective composed options.

Await queue writes. Deduplicate achievement jobs by connection/account/user/external game while pending or active; separate providers' external games must not collide. Queue a compact identity and selection reason, not entire library snapshots. Remove the constructor side effect. Existing retained importer jobs require a targeted rollout cleanup by queue/name/state, never a global Redis flush.

Use finite request timeouts (proposed 30 seconds per leaf request) where the installed client supports cancellation, and an overall per-connection attempt deadline (proposed ten minutes). Retain `psn-api` without replacing, patching, or intercepting its transport. Its in-flight requests cannot be cancelled and may outlive either deadline; PSN hard request/attempt duration and transport-resource release guarantees are explicitly dropped. Check attempt eligibility between PSN calls and before persistence, without claiming an outer Promise timeout cancels network work. Pagination also has progress/cycle checks. Existing retry counts remain bounded; permanent unsupported/no-achievement results terminate normally, while retryable failures preserve their cause. Do not pretend a worker concurrency of one enforces provider request quotas across replicas or queues. Apply provider-wide Redis-backed cooldown on observable 429 and a shared conservative concurrency bound to outbound leaf calls; no numeric provider quota is invented without evidence.

The retained PSN library returns decoded JSON and does not expose HTTP status or headers. Classify only errors/status/retry metadata actually exposed by its public API; ambiguous failures remain failed/incomplete. PSN HTTP Retry-After preservation and classification of hidden HTTP statuses are explicitly out of scope. Do not infer throttling, privacy, or unsupported outcomes from ambiguous messages or empty/malformed payloads. Pagination guards, bounded retries, data preservation, and shared admission still apply.

### 4. Fetch complete provider snapshots before advancing state

Provider fetch results explicitly distinguish complete success, empty success, unsupported/no-achievements, private/unavailable, throttled, and failed/incomplete. Throw or return a typed failure for incomplete pagination; do not cache incomplete arrays as successful snapshots or advance success markers. Existing complete local data remains available while refresh fails.

Steam keeps both owned-library and recent-game requests, with recent results taking precedence by app ID. This preserves Family Sharing and the existing missing-library workaround. A failed required component is not silently converted into a complete snapshot.

PSN passes an explicit supported page limit, advances using actual returned counts/continuation metadata, detects repeated offsets, and terminates on exhaustion. Apply the same completion discipline to played games, title lists, and paginated trophy details. Never assume the largest allowed page is the default. Xbox requests non-overlapping statistics slices no larger than 1,000 and advances even when a successful batch has no statistics. Follow verified continuation contracts for Xbox obtained-achievement responses and PSN trophy details instead of silently accepting maxItems truncation.

The current Xbox TitleHub library endpoint has no verified continuation contract in the installed client or available primary documentation. Retain its existing explicit `maxItems: 5000` request, and reject a structurally valid response containing 5,000 or more titles, or one otherwise indicating truncation without a verified way to fetch the remainder, as an incomplete failure. Even a library containing exactly 5,000 titles is conservatively rejected because completeness cannot be established at the cap. Do not fabricate cursor parameters or treat generic Xbox PagingInfo documentation as proof of TitleHub support. A valid below-cap response with no indication of truncation can follow the normal complete/empty path. Capped/unpageable results must not be cached as successful snapshots, advance success markers, or replace earlier complete local data; retain visible failure and existing bounded retry behavior. This limitation remains until a supported endpoint/continuation contract is verified against primary documentation or captured multi-page responses. Verification and removal of the limitation are future work, not a prerequisite for implementing this conservative failure path.

Await PSN mapping persistence before achievement work. Mapping identity is `(npCommunicationId, npServiceName)`; grouping by game name alone cannot establish identity. Reuse a verified concept-to-title association where available; ambiguous matches remain unresolved and visible rather than guessing. Preserve existing mappings, with bounded reconciliation for demonstrably incomplete ones.

### 5. Select achievement work before enqueuing

Persist per connection/account/external-game synchronization state: successful timestamp, supported/empty outcome, last observed activity/change fingerprint, next reconciliation eligibility, and retry status. Prefer one small entity for this state; do not infer synchronization success from obtained-row existence.

Selection reasons are: never successfully synchronized, a meaningful activity/progress signal changed, prior incomplete/failed work is due, or the last successful check is at least seven days old. Daily freshness still prevents redundant successful refreshes within a day. Recent activity is a candidate signal, not proof that a fetch is required every scheduler tick. PSN trophy-title `lastUpdatedDateTime` and progress counts can drive selection. Steam must preserve its recent-list fallback when timestamps are absent. Xbox achievements must not depend on MinutesPlayed being available; select from the title/progress snapshot independently of statistics.

A successful zero-achievement result advances state. Newly introduced mappings and changed catalogue versions make affected games eligible for reconciliation; they do not require rescanning all users immediately. Do not restore the commented old-game `return` as the entire solution.

Fetch the obtained snapshot and required catalogue once per game execution and pass them to completion/activity calculations. Cache hits do not justify repeated service calls and database hydration. Avoid fetching rarity/localized presentation data when the completion calculation does not need it, while preserving it for display consumers.

### 6. Achievement persistence is atomic and publication is recoverable

Fetch and validate provider data before opening a transaction. Under a user/external-game serialization boundary, insert genuinely new obtained rows, update completion from the same complete snapshot, create the corresponding local activity record, and advance successful sync state in one local transaction. Keep existing uniqueness constraints and handle concurrent attempts deterministically. Existing completion timestamps are preserved unless a real transition warrants a new value.

Publish the resulting activity through the existing activity queue after commit using a deterministic identity. Persist a minimal pending-delivery marker on the local activity record and retry pending publication through the existing worker path; this closes the commit/enqueue crash window without introducing a general outbox framework. If the existing activity pipeline has a durable equivalent, reuse it. Clear the marker only after confirmed enqueue, and make downstream activity creation idempotent for the same source ID. All HTTP and worker persistence routes must converge on this path.

Alternative rejected: only wrapping obtained-row inserts in a transaction, because it does not cover status, activity records, or post-commit delivery loss.

### 7. Playtime is observed cumulative data, not reconstructed sessions

Capture one observation timestamp and one period window per attempt. Read existing playtime rows in a bounded batch keyed by user/game/source/platform; pass known existing values into the shared persistence path without creating an unsafe public trust bypass. The manual DTO currently has no validation decorators. Add Nest/class-validator validation at the HTTP boundary: positive safe-integer game/platform IDs, a UserPlaytimeSource enum value, integer seconds from 0 through 2,147,483,647 (the existing signed INT storage range), and an optional/null valid played date transformed with class-transformer. Retain session-derived ownership and explicit field projection in submit; provider DTOs remain independent. Use maps/sets for per-library matching rather than nested scans.

Atomically persist a changed cumulative observation and current row. Identical observations do not create duplicate history; unchanged cumulative totals still require recent-time expiry to be evaluated against the shared window. Hash canonical provider/current values consistently, and compute age as `now.diff(updatedAt)`. Separate derived rolling totals from external-change detection so an expired recent value cannot remain frozen by a matching checksum.

For a period, include the last trusted observation at or before the start plus observations through the end. Count non-negative increments between observations; assign an interval's increment to its ending observation for existing period APIs and document that attribution as estimated. Example: 100 seconds before the period and 160 inside it contributes 60; one first-ever sample of 160 contributes no inferred historical 160. A lower cumulative value starts a new baseline and never produces negative playtime or MAX-MIN inflation. Existing historical rows remain unchanged; legacy observations with unreliable timestamps retain a documented precision limit.

For provider-supplied rolling recent totals (Steam), retain provider semantics. For PSN/Xbox, aggregate the required window once per user/source/platform batch and derive all games' recent values from it. Index observation queries after inspecting their actual predicates with EXPLAIN. Preserve authoritative PSN playCount; stop increasing Steam/Xbox totalPlayCount per detected change and preserve existing counts until an authoritative source supplies them. No false session reconstruction or blanket reset is performed.

### 8. Discovery, auto-import, and notifications retry independently

Treat no new games as successful empty work, preserving a deliberate HTTP compatibility adapter if current clients rely on 404. Fetch/merge a library snapshot once for due consumers in the same run where practical; do not create a permanent snapshot-storage system solely for reuse.

Keep processed, ignored, notified, and automatically imported meanings separate. A notification cannot mark an unsuccessful auto-import as completed. Collection insertion/status transition is idempotent and transactional where local repositories permit. A retry that finds an already-created collection entry finishes the missing processed transition instead of abandoning the item. Send notifications only for committed outcomes, deduplicate their source identities, and retry failed delivery without repeating successful imports. Reuse existing records/constraints before adding new state; do not silently replay every historical notified entry during rollout.

### 9. Validate work reduction with counts before tuning concurrency

Emit bounded per-run summaries using existing logging/OpenTelemetry: source, outcome, duration, provider leaf-call count, games seen/selected/skipped/changed, database query/row counts in tests, queue age, retries, and partial failures. Do not use user IDs or game IDs as metric labels or expose tokens/provider response bodies. Compare cold and warm runs for a large inactive library with a small active subset. Separate jobs from actual HTTP requests and compare snapshots with equivalent correctness.

No percentage target is promised without a baseline. Acceptance requires fewer selected jobs and eliminated repeated reads/fetches on unchanged inputs, bounded memory/page processing, and preserved result correctness. Provider quotas and fleet size remain operational measurements, not assumptions used to approve increased frequency.

## Risks / Trade-offs

- [Daily updates increase visible staleness] -> Expose last-success/next-eligible status, preserve immediate onboarding, and document the cadence.
- [Polling cannot recover exact play dates or sessions] -> Attribute deltas explicitly as estimates and preserve unknown baseline history.
- [PSN name-based associations are ambiguous] -> Keep unresolved mappings visible and avoid attaching trophies to an unverified game.
- [Partial snapshots can falsely regress completion] -> Require completeness before status changes; retain previous results on failure.
- [State bootstrap creates a large initial backlog] -> Spread existing connections over 24 hours and page games in bounded batches.
- [Queue removal settings interact with stable IDs] -> Test effective Nest options and use distinct run IDs plus durable admission.
- [PSN SDK hides transport metadata and cannot cancel requests] -> Retain the library, report only observable errors, and document that an in-flight PSN call can outlive attempt deadlines.
- [Provider/client behavior differs from documentation] -> Test the installed versions with fixture-driven boundary cases and validate live calls only with authorized test accounts.
- [Xbox libraries at the TitleHub request cap cannot be confirmed complete] -> Reject them visibly, retain prior data, and leave success unchanged until supported continuation is verified. This also rejects exactly-at-cap libraries that may actually be complete.
- [Multiple replicas expire leases during slow calls] -> Bounded attempts, lease renewal where needed, and owner/account checks before commit.
- [HTTP freshness behavior changes] -> Preserve response shapes, add explicit status, and include a client compatibility review before rollout.
- [New local state grows with account libraries] -> Compact rows, indexed due queries, account-disconnect cleanup, and bounded job retention.

## Migration Plan

1. Ship regression fixes and explicit queue lifecycle independently of the cadence switch. Confirm the importer can execute again after completion.
2. Add reversible TypeORM migrations for connection admission, per-game state, pending activity delivery, and only necessary observation indexes. Register entities with existing modules. Do not delete or rewrite imported history.
3. Initialize existing accounts conservatively: a persisted achievement is not proof of a complete snapshot. Spread initial reconciliation; retain previous data during backfill. Document a safe cutoff so old feed events are not mass-republished.
4. Clean only retained completed/failed legacy importer jobs that block recurrence. Preserve active/waiting jobs and unrelated queues.
5. Deploy complete-snapshot handling, shared persistence, and HTTP compatibility together so old paths cannot bypass new admission. Drain or reject legacy payloads explicitly during a coordinated worker rollout.
6. Enable daily eligibility after regression and integration checks pass. Monitor at least two daily cycles plus a controlled seven-day reconciliation clock test; do not require waiting seven real days in tests.
7. Compare before/after counts and freshness. Roll back cadence/admission activation to the prior deployment if necessary while retaining imported rows and pending delivery state. A binary rollback must account for legacy workers ignoring new admission; pause scheduling during mixed-version recovery. Do not reverse additive migrations until no running version or pending job depends on them.
