# Design

## Context

See `proposal.md` for motivation and capability boundaries. A design is required because this change crosses producers, persistence, queues, authorization, and public contracts.

Observed implementation:

- `NotificationsService` selects only actor profiles, groups raw records after offset pagination, and uses a five-minute shared Redis marker for `/new`.
- `Notification` has nullable relations for each source category. A comment notification identifies its root or parent, without the new comment's causal identity.
- `StatisticsActionDto.targetUserId` becomes the like notification recipient without ownership verification. `handleLike` persists reaction, counter, and notification separately; a retry after partial persistence can return early.
- Comment, follow, and report services publish outside their local writes. Report handling can publish before closing the report.
- Import discovery already commits result records and recovery markers transactionally. Its separate queue acknowledgement and `deliveryIdentity` mechanism must converge on the new outbox while preserving the requirements in `optimize-player-data-imports/specs/library-auto-import/spec.md`.
- Posts use soft deletion. Other sources and actor/recipient relations use cascading deletion. Collections already have privacy rules that a materialized preview must respect.
- MySQL 8.x, TypeORM transactions, BullMQ, Nest scheduling, Redis, and logging are available. The production Compose selects `allkeys-lru` for BullMQ Redis; the actual deployed policy and workload are unverified.

The user confirmed that action success must not depend on asynchronous notification generation, and that the unpublished site needs no legacy API compatibility. Five failure cases were reproduced through in-memory assertions during exploration; no production timings or database plans were measured.

## Goals / Non-Goals

**Goals:** Move source resolution off list rendering; make delivery recoverable after a committed action; enforce trusted recipients and consistent reactions; make adding an existing-style flow local to its producer and handler; replace the old contract and model directly.

**Non-Goals:** A general event bus, event sourcing of domain state, a new database/broker, frontend implementation, new channels or mention/broadcast flows, and a separate rewrite of view counters, achievements, or provider synchronization. Do not preserve old endpoints or entities merely for compatibility.

## Decisions

### 1. Materialize an inbox in the existing MySQL database

Keep three cohesive stores inside `src/notifications`:

| Store | Data and responsibility |
| --- | --- |
| `notification_outbox` | Immutable event identity/key, type/version, occurred time, trusted source facts, recipient/actor when known, and mutable delivery ownership, attempts, next-attempt time, completion, and bounded error state. |
| `notification_event` | One delivered contribution per event and recipient, linked to its inbox group. Stores causal/subject/root identities, actor identity, safe preview/target facts, original event time, and any one-time migration read information. Unique `(eventId, recipientUserId)`. |
| `notification_inbox` | One rendered item per recipient/group key: type, subject/root references, bounded preview and destination, at most three distinct actor IDs, event/actor counts, latest event ordering key, version, read version, and visible/redacted state. Unique `(recipientUserId, groupKey)`. |

Use explicit columns for recipient, identities, ordering, state, and indexes; use bounded, validated JSON for presentation and target variations. Keep recipient/profile referential integrity where applicable, but remove the per-domain-source foreign-key columns. Use typed source resolution and explicit lifecycle handling in place of those polymorphic foreign keys. Retain deduplication identities for at least the supported retry/migration horizon; purging a transport job or large outbox payload must not permit replaying an already delivered event as new.

Index inbox reads by `(recipientUserId, lastEventAt, id)` and visible unread counting by recipient/state/unread status. An indexed generated unread expression can derive `readVersion < version` without maintaining a second conflicting truth. Index event membership by group/actor for distinct counting and index subject/root references for redaction. Index outbox due-state/retry/lease predicates after checking their actual SQL plans.

Alternative rejected: loading every source relation on reads. It retains graph coupling and transfers repeated work to every poll. A different read database adds synchronization and operational work without evidence it is needed.

### 2. Persist intent synchronously; render asynchronously

The service that owns an action uses the same transaction-scoped `EntityManager` to persist the action and append its typed outbox event. Append records only minimal committed facts and necessary routing identities. Preview extraction, larger context resolution, and Redis calls occur later. All current producers have one recipient, so there is no broadcast/fan-out framework.

An outbox write failure rolls back the local transition. This is the explicit durability boundary; a committed action cannot be guaranteed recoverable if its intent was never saved. Once both commit, subsequent notification failures do not alter the action or require the client to retry it. Never open another independent transaction for the intent when a caller already has one.

The outbox is a notification delivery record, not an authoritative replay log for likes, comments, or imports. Recovery never calls the original domain mutation.

Alternative rejected: direct inbox generation in the domain transaction. It would couple action availability to presentation work, contrary to the user's decision. An in-memory emitter or post-commit enqueue alone leaves the commit/enqueue crash window open.

### 3. Use one durable retry authority and explicit processing ownership

Register one shared BullMQ Job Scheduler in the existing notification queue, using `upsertJobScheduler` with the fixed identity `notifications-relay` during module initialization. Its `notifications-relay-tick` jobs call the relay through the existing processor, initially every 1000 ms with at most 100 due rows claimed per tick. All replicas register the same schedule; adding replicas does not add independent polling timers. Tick jobs use one transport attempt and the same bounded retention as notification jobs. Queue load can delay ticks, so the interval is a scheduling target rather than a delivery deadline. The batch bound applies to each shared tick, not to each replica; validate pending age and throughput before changing these starting constants.

Claim rows through short MySQL transactions with `FOR UPDATE SKIP LOCKED`, assigning an expiring owner token. For an ordinary batch of N pending rows below the retry limit, use one locking selection and N updates, returning the loaded rows with their new state, token, lease, and incremented attempts instead of selecting each row again. Redis publication remains outside the transaction. Keep ownership checks and database deduplication because a shared schedule does not promise exactly-once execution.

Queue only an event ID and attempt token. Give each claimed attempt a distinct BullMQ job ID such as `notification-<eventId>-<attemptToken>`; database identities enforce lasting deduplication. Set notification jobs to one transport attempt so outbox retry state is the single retry authority. Outbox failures use finite exponential backoff, initially five automatic attempts, followed by durable failed state and targeted operator rearm. Unknown event versions fail visibly without repeated automatic execution. Suppressed events complete with a safe reason.

An enqueue acknowledgement does not complete the outbox record. The worker verifies current ownership, validates source eligibility, and atomically commits event insertion, inbox contribution, and outbox completion. Claim expiry recovers process death or lost queued work. Stale attempt tokens cannot apply or complete work. A failed event does not block later due rows; operators can rearm a specific event after resolving its cause. Rearm invalidates the old owner and does not rerun the domain action.

Set explicit bounded success/failure job retention and `noeviction` on the BullMQ Redis instance; keep the cache Redis policy separate. Verify persistence and memory limits during deployment. Avoid native retries multiplied by unrelated outbox retries, permanent job IDs that strand failed work, and counters that mark work delivered merely because Redis accepted it.

### 4. Keep event extension small and typed

Use a discriminated, versioned internal event union and a small handler registry. Producers append trusted facts from rows they just persisted; handlers use repositories with selected fields instead of importing every full domain service and creating module cycles. New supported kinds require a producer, handler/target policy, and a focused fixture, not another nullable source column or generic plugin system.

| Event | Recipient and causal data |
| --- | --- |
| `content.liked` | Persisted owner of the supported review, post, activity, or comment; causal identity is the new like transition. Game likes have no recipient. |
| `comment.created` | Content owner; retain the newly saved comment and root context. |
| `comment.replied` | Immediate parent-comment owner; validate that parent and new comment belong to the same root and preserve both comment IDs. |
| `profile.followed` | Followed profile; causal identity is the newly inserted follow relationship. Repeated follow requests do not emit again. |
| `import.discovery-completed` | Library owner; retain the committed discovery-result ID, provider, game count, bounded game preview, and imported/skipped/failed counts. |
| `moderation.applied` | Affected profile with a system actor; only safe committed outcome data. Discarded reports emit nothing. |

Self-notifications are suppressed, not treated as failed actions. For importer discovery, append the event in `commitPage` alongside its result and choices, then remove `deliverNotification`, its cron recovery, and `pendingDelivery` once existing pending records have been transferred. Keep the importer result entity/detail operation if needed for its domain result; remove notification-only fields and relations. Preserve `autoImportRetryable`, processed/ignored decisions, and the existing result counts.

For report handling, use one local transaction covering the applicable moderation writes, report closure, and safe intent. Publish no alert before report closure commits. Preserve the existing external/session permission checks and ensure internal handlers cannot bypass outcome authorization. Keep only safe outcome facts in delivery payloads rather than serializing `Report`.

### 5. Apply reactions directly through the shared local transaction

Add `PUT /statistics/like` and `DELETE /statistics/like` to the existing statistics controller, under the application's current URI prefix. Both accept only a validated source type and type-appropriate source ID, use the session actor, and return committed `{ isLiked, likesCount }`. Reuse the existing authentication, suspension, and throttling facilities. Use strict reaction-specific DTO validation; do not change unrelated view DTO behavior globally.

Keep the source-type mappings and statistics entities already in the project. In `StatisticsService`, validate and lock the actual source/owning context before creating statistics, then serialize that source's counter transition. Use existing reaction unique constraints and actual insert/delete results as the decision to change counters and append intent. Initialize absent statistics inside the same transaction and handle its uniqueness race. Apply a consistent lock order and bounded deadlock retries for the whole transaction; no Redis or network I/O occurs while holding the locks.

Remove `StatisticsQueueService.registerLike`, queued-like controller routes, the processor's like branch, and its obsolete payload type. Retain queued views and statistics initialization. The direct write is small local work and avoids accepted-but-not-persisted like commands, ordering across two queues, and loss before notification intent exists.

Unlike changes active state/counters but does not retract delivered history. A later new like uses a new persisted transition identity; historical event count, distinct actors, and active `likesCount` are different values. Self-likes and game likes may persist according to the existing domain rules but do not acquire invented recipients.

### 6. Aggregate once with deterministic identities and bounded previews

For `content.liked`, `comment.created`, and `comment.replied`, derive the group key from recipient, kind, subject type/ID, and the event's UTC calendar date. Replies group by their parent-comment subject; top-level comments group by the content root. Follow, importer, and moderation events use their event identity as the group key. Late processing uses occurrence time, not worker time.

The projection transaction locks/upserts the group, inserts the unique event contribution, and changes counts only for a new contribution. A group/actor membership check under the group lock distinguishes another event from another person. Keep the latest three distinct actor IDs; fetch only public username/avatar fields in one batch during reads. Preserve latest preview/target ordering by `(occurredAt, eventId)` so an older event processed late cannot replace newer content.

Increment `version` only for a new contribution. `readVersion` is the greatest valid acknowledged version, so duplicates and out-of-order acknowledgements cannot erase unread work. A read request supplies the item ID and observed version; reject future versions and items outside the session owner's inbox. Validate the whole bounded acknowledgement request before changing any item.

Preview and target schemas are allowlisted. Cap plain-text preview at 240 characters, actor samples at three, and importer game samples at three with an exact total. Do not return raw HTML, full entities, provider credentials, reporter identity, or arbitrary URLs. No safe HTML-to-text helper was found during discovery: the initial implementation uses a generic plain-text summary for HTML-only bodies unless an existing trusted extractor is available. Do not introduce regex-based HTML sanitization. Document that limited excerpt behavior in the required `shortcut:` comment if applicable.

### 7. Replace the notification contract in place

Keep the application's existing URI versioning; `/v1/notifications` becomes the sole new contract, not an old implementation kept alongside `/v2`. Relative operations:

- `GET /notifications?cursor=<opaque>&limit=20` returns `{ data, pagination: { nextCursor, hasMore }, unreadCount }`.
- `PATCH /notifications/read` accepts `{ items: [{ id, version }] }`, with at most 100 items, and returns success for a valid idempotent acknowledgement.
- Remove `GET /notifications/new`, `PUT /notifications/view`, old aggregation DTOs, offset semantics, and the cache last-checked-date mechanism. There is no arbitrary public create operation.

Each item contains `id`, `type`, `actors`, `preview`, `target`, `eventCount`, `actorCount`, `lastEventAt`, `version`, and `readVersion`. Targets distinguish root navigation and optional focus IDs; an activity target includes its resolved content/game context. Opening full content still uses the content endpoint's authorization.

Use a notification-specific DTO with integer `limit` from 1 to 100 and an opaque cursor encoding the recipient and ordering tuple. Validate its structure and bind it to the session user; every SQL query still filters the session owner. Fetch `limit + 1` groups, never all members. Reuse the existing cursor-query conventions but do not call `findAndCount` or add a full-history count to satisfy the old pagination interceptor. Compute visible unread-group count through its index initially; introduce no counter table without evidence.

The baseline list path is an inbox query, one batched profile query when needed, and unread counting. Additional eligibility checks are batched per supported source category, not per item, and select only existence/access metadata. Refill filtered candidates using bounded batches and the last scanned ordering key, returning an empty/short page plus a continuation when its bounded scan budget is reached. `hasMore` describes remaining candidates, not a guaranteed full visible next page. A live group can move above an earlier cursor; clients refresh the top and replace current item payloads by stable ID. Event versions govern read acknowledgements, not cache freshness: actor updates and redactions can change presentation without another contribution. The API does not promise a historical snapshot or an exactly-once toast stream.

### 8. Enforce lifecycle and privacy before serving snapshots

Index subject and root references so source deletion/moderation/private transitions can invalidate affected inbox previews in their local transaction. The projector revalidates current source status under compatible source/root locks before committing visible content; otherwise a delayed worker could recreate a preview after invalidation. Use the same lock ordering in writers and projector, and exercise the race with two database connections.

Batch-check current access/existence metadata at reads as a backstop for the actual supported context categories, especially activity references to private collections. Do not fetch full content graphs. Counts and visibility must reflect the same invalidation policy. Deleting a whole root suppresses its groups; deleting only a group's latest triggering comment redacts or replaces the excerpt/focus without blindly deleting unrelated contributions or resetting read state. Removed actor profiles yield a safe missing-actor representation rather than retaining private profile snapshots.

Typed references remove automatic source cascades, so these writer paths and tests are part of the change, not deferred cleanup. Ordinary text edits can retain the notification-time safe summary; removal, moderation, and access revocation cannot rely on eventual preview cleanup alone.

### 9. Migrate data once, with no runtime legacy support

Use a pre-launch maintenance cutover: stop ingress and producers, inventory/drain or durably capture relevant legacy queue work, and stop old workers before switching contracts. No double writes, frontend compatibility adapter, feature-flag rollout, or old-source read fallback is needed.

Create replacement stores and perform bounded, checkpointed conversion of existing notifications with keys such as `legacy-notification-<id>`. Preserve available occurrence times and read state, mark all-read groups fully read, and leave mixed groups unread. Conversion does not run domain mutations or announce old history as new. Missing causal comment IDs remain absent. Recheck source ownership on old like notifications; never blindly preserve a forged recipient. Unavailable, unassignable global, or inconsistent legacy records are excluded from the new visible inbox with an explicit inventory retained in the pre-cutover backup for targeted handling, not silently reassigned or broadcast.

Transfer existing committed importer pending results into the outbox using their result identity without reimporting games. Capture incompatible pending/failed legacy queue payloads for targeted conversion rather than dropping them or executing an obsolete handler after cutover. Do not claim the new delivery guarantees can reconstruct causes or jobs already lost by the old implementation.

Drop replaced tables/columns, queue methods, and recovery code only after conversion checks pass. Retain only the migration/checkpoint mechanism needed for the cutover; no legacy module remains in the runtime path. Domain accounts, likes, comments, follows, collections, imports, reports, and processed/ignored choices are not disposable just because the frontend is unpublished.

Rollback after destructive schema cleanup requires the coordinated database backup and previous code while ingress/workers are stopped. A `down` migration alone cannot reconstruct missing causal information or new-schema state. Document this explicitly rather than promising lossless rollback through schema reversal.

### 10. Verify behavior and work reduction before tuning

Use focused unit tests for DTOs/handlers/read versions and disposable MySQL/Redis integration fixtures for actual transactions, uniqueness, leases, migrations, two-worker races, and privacy invalidation. Reuse the existing test infrastructure, not a second database stack. Cover commit/enqueue and materialization/acknowledgement crashes, Redis loss, stale ownership, and permanent poison events.

Record mixed-source pages, a single very large group, many groups for one recipient, and cold/warm reads at limits 20 and 100. Capture query counts, rows examined/`EXPLAIN`, response bytes, p50/p95/p99 list latency, reaction transaction latency, and commit-to-visible latency. Verify source/profile query counts scale with supported categories rather than items, and verify no source provider calls occur. No numeric production capacity or percentage latency improvement is asserted without the baseline.

Expose bounded logs/metrics for event kind/outcome, pending age, completed latency, retries, suppressed events, and failure totals. Keep user/game/event IDs out of metric labels; targeted diagnostic commands may identify a specific event without dumping payloads or secrets. Document retention, failed-event rearm, memory pressure, migration counts, and the sole API contract in `docs/notifications.md`; update importer operations documentation to remove obsolete marker instructions.

## Risks / Trade-offs

- [Outbox writes add local work and can fail] -> Keep intent minimal, include it in the domain transaction, and measure reaction latency; asynchronous failures remain independent after commit.
- [One popular source/group contends on locks] -> Short local transactions, consistent lock order, atomic counters, and measured concurrency; do not add sharding before evidence.
- [Generic references no longer cascade automatically] -> Indexed lifecycle invalidation, current eligibility checks, and deletion/privacy race tests before cutover.
- [Actor changes or deleted HTML sources make snapshots stale] -> Read current public actor summaries in a batch; redact inaccessible content and use bounded generic summaries when safe extraction is unavailable.
- [Mutable grouping changes pagination order] -> Stable group IDs, explicit live-list refresh semantics, bounded cursor/refill queries, and no claim of snapshot traversal.
- [Failed transport jobs outlive their owners] -> Attempt tokens, expiring database ownership, database deduplication, and explicit finite outbox retries.
- [A retained outbox/event ledger grows] -> Bounded payloads, indexed state, and documented retention that preserves the supported deduplication horizon.
- [Historical records lack causal identity or valid ownership] -> Safe one-time conversion, explicit exclusion counts, and backup preservation without fabricating a comment, recipient, or broadcast.
- [Unrelated work is already present in the workspace] -> Implement only the listed integration paths and preserve other connection/import changes.

## Migration Plan

1. Capture old behavior/query baselines and export a consistent database/relevant-queue backup. Document the maintenance boundary and inventory pending/failed work and global/unverifiable legacy rows.
2. Add the three stores, identities, indexes, typed append/projector contracts, and retry ownership; verify migrations and transaction failure cases on disposable services.
3. Convert all current producers and the local reaction boundary. Complete privacy/deletion integration before the inbox is exposed. Replace importer recovery without resetting its domain choices.
4. Stop old ingress/workers, transfer committed pending delivery, and run checkpointed historical conversion. Verify counts, ownership exclusions, read-state mapping, and absence of replayed actions before removing old storage and queue payload paths.
5. Deploy the sole replacement API, update OpenAPI/docs, configure BullMQ Redis `noeviction` with verified persistence, and run mixed-source/failure/performance acceptance checks. Frontend integration follows separately.
6. If cutover fails before reopening writes, restore the coordinated backup and old code. After new writes resume, prefer a forward fix; restoring an old backup would discard those writes and requires an explicit maintenance/data recovery decision.

## References

- [CQRS with models in one data store](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs)
- [Materialized view lifecycle and access control](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view)
- [Transactional outbox and duplicate delivery](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html)
- [BullMQ production persistence and noeviction](https://docs.bullmq.io/guide/going-to-production)
- [BullMQ job ID retention limits](https://docs.bullmq.io/guide/jobs/job-ids)
- [MySQL locking reads and queue-like SKIP LOCKED use](https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html)
- [OWASP object authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
