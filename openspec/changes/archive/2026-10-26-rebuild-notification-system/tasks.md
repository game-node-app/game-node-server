# Tasks

The 2026-10-25 implementation review found incomplete acceptance criteria. Reopened items below retain the original requirements; sections 11–16 track the concrete corrections and their regressions. Completion requires both implementation and the stated verification.

## 1. Persistence and typed intent

- [x] 1.1 Add notification outbox, individual-event, and inbox entities with recipient/group/event identities, ordering, bounded payloads, read versions, and lifecycle indexes; register them in TypeORM and verify migration creation and uniqueness on disposable MySQL.
- [x] 1.2 Add the versioned internal event/target union and transaction-scoped intent append operation without a general event framework; verify unsupported versions, invalid identities, and oversized payloads are rejected and an injected append failure rolls back its caller's transaction.
- [x] 1.3 Add the initial schema, identity, and retention notes to `docs/notifications.md`; verify every documented store/index exists and the documented durability boundary distinguishes intent persistence from later generation failure.

## 2. Recoverable relay and queue lifecycle

- [x] 2.1 Implement bounded due-row claims with expiring owner tokens and a short relay tick, outside-transaction Redis publication, and per-attempt job identities; verify two relay instances do not concurrently own one event and a commit-before-enqueue crash is recovered.
- [x] 2.2 Make outbox state the single retry authority with finite exponential backoff, explicit failed/suppressed/completed outcomes, and one BullMQ transport attempt; verify unavailable Redis, disappearing accepted jobs, expired owners, poison events, and exhausted attempts do not strand or silently discard intent.
- [x] 2.3 Set explicit bounded success/failure job retention and validate effective queue options against global Nest defaults; verify removed/retained jobs do not defeat database deduplication or prevent a rearmed attempt.
- [x] 2.4 Document pending-age diagnostics, owner expiry, failure inspection, targeted rearm, and deduplication retention in `docs/notifications.md`; verify the documented recovery procedure retries one event without invoking its original domain mutation.

## 3. Materialization and grouping

- [x] 3.1 Add handlers for the existing like, comment/reply, follow, import-result, and moderation event kinds using selected repository fields; verify each resolves the trusted recipient, triggering identity, subject, root, and typed destination without exposing full entities or arbitrary URLs.
- [x] 3.2 Atomically create each unique event contribution, update its UTC-day group, and complete its currently owned outbox record; verify duplicate workers, acknowledgement loss, stale tokens, and rollback leave one visible effect and preserve read state.
- [x] 3.3 Maintain distinct actor/event counts, at most three actor IDs, latest-event ordering, and bounded previews/import game samples; verify repeated actors, more than 20 contributions to one group, next-day grouping, late older events, system actors, and self-notification suppression.
- [x] 3.4 Return safe plain-text previews with a 240-character bound and safe media metadata; verify hostile/raw HTML and privileged moderation fields never appear, use a generic summary when no trusted text extractor exists, and document that limit with the required `shortcut:` comment and contract notes.

## 4. Secure committed reaction commands

- [x] 4.1 Add strict source-only reaction DTOs and authenticated `PUT/DELETE /statistics/like` operations using existing suspension/throttling facilities; verify forged recipient/actor properties, invalid source IDs, unsupported types, missing targets, inaccessible sources, and suspended accounts cannot change state.
- [x] 4.2 Make the shared reaction service validate/lock source context and atomically persist real reaction transitions, counter changes, and intent using transaction-scoped repositories; verify same-user duplicate likes, concurrent different-user likes, concurrent unlikes, missing-statistics initialization, and non-negative counters on MySQL.
- [x] 4.3 Verify counter/intent failures roll back the full reaction and a retry can finish it; verify successful local commits return `{ isLiked, likesCount }` while Redis is unavailable, and like/unlike/like uses distinct real-transition identities without conflating historical notification counts with active likes.
- [x] 4.4 Remove queued-like controller operations, `registerLike`, its processor branch, and obsolete payload types while retaining queued views and statistics initialization; verify retired routes are unavailable, old jobs cannot mutate through a stale handler, and view/init regression checks pass.
- [x] 4.5 Document the new reaction operations and refresh their OpenAPI definitions; verify examples contain no actor/recipient input and match actual committed responses and validation errors.

## 5. Transactional source producers

- [x] 5.1 Move comment/reply intent into comment persistence, validate parent/root consistency, and retain the new comment plus parent/root IDs; verify top-level and reply recipients, self-actions, mismatched roots, and transaction rollback with focused fixtures.
- [x] 5.2 Append follow intent only for a newly committed relationship; verify duplicate/concurrent follow requests do not create another event and publication failure does not roll back an already committed follow.
- [x] 5.3 Append import discovery intent inside `commitPage` with the result identity and committed counts; verify mixed outcomes, delivery failure/retry, and duplicate recovery preserve `autoImportRetryable`, processed/ignored choices, and successful imports in the existing importer integration fixtures.
- [x] 5.4 Commit moderation writes, report closure, and recipient-safe intent together while preserving permission checks; verify failed closure cannot deliver an alert, discard emits nothing, and suspension/ban/alert results use a system actor without reporter/internal data.
- [x] 5.5 Update importer operations documentation and producer contract fixtures to describe the shared outbox; verify new failures recover through that path and source operations never call the legacy fire-and-forget notification publisher.

## 6. Source lifecycle and access protection

- [x] 6.1 Integrate indexed invalidation with hard deletion, post soft deletion, moderation removal, collection privacy changes, and applicable profile/account cleanup; verify removed/private source previews and destinations are unavailable without deleting unrelated domain data.
- [x] 6.2 Add projector source/root eligibility checks with compatible lock ordering and bounded batch read checks for supported contexts; verify a two-connection deletion/privacy race cannot recreate protected previews after invalidation.
- [x] 6.3 Redact or replace a deleted latest comment's excerpt/focus while preserving other safe group contributions and acknowledgements; verify missing actor profiles use safe public representations and unread visibility follows the same policy.
- [x] 6.4 Document source lifecycle responsibilities and the notification-time summary policy; verify every source type in the handler registry has a covered removal/access-change path or an explicit inapplicable case.

## 7. Sole inbox API and read state

- [x] 7.1 Replace the notification list with materialized item DTOs, recipient-scoped validated cursors, integer limits 1-100, `limit + 1` continuation, and indexed unread counting; verify timestamp ties, cross-user cursors, oversized limits, empty inboxes, and no full-history `findAndCount`/member loading.
- [x] 7.2 Batch public actor fields and source eligibility metadata, with bounded refill/continuation after filtered candidates; verify mixed pages of 20 and 100 have category-bounded query counts and no per-item source API/provider calls, including short/empty continuation pages.
- [x] 7.3 Add bounded `PATCH /notifications/read` acknowledgements through observed versions; verify session ownership, repeated/out-of-order acknowledgements, whole-request validation, future-version rejection, and a concurrent newer event remaining unread.
- [x] 7.4 Remove `/notifications/new`, `/notifications/view`, old aggregation/source DTOs, offset pagination, and the cache discovery marker; verify repeated GETs and two devices do not consume notifications and cache eviction/restart does not erase unread state.
- [x] 7.5 Update OpenAPI and `docs/notifications.md` with the sole in-place contract, typed targets, grouping/count semantics, live pagination, and read versions as acknowledgements rather than cache validators; verify a contract fixture can render every supported item with one list response.

## 8. One-time data and queue cutover

- [x] 8.1 Add bounded, checkpointed historical conversion with deterministic legacy identities, conservative read-state mapping, safe missing-trigger handling, and recipient revalidation; verify restart/repetition, mixed read groups, missing comments, forged legacy recipients, and unassignable global records without replaying domain actions.
- [x] 8.2 Transfer committed pending importer results and durably inventory incompatible pending/failed legacy queue payloads before retiring their handlers; verify notification recovery never reimports games and no captured work is silently dropped or executed through a removed like path.
- [x] 8.3 Remove replaced notification relations/storage/exports and importer-only delivery markers/cron methods after conversion checks; verify fresh and upgraded database fixtures start with only the new runtime path and retain source entities, import retry state, and processed/ignored choices.
- [x] 8.4 Document and exercise the pre-launch maintenance cutover, backup, migration counts/exclusions, and rollback procedure on disposable services; verify no v1 adapter, parallel v2 contract, double writes, or runtime legacy fallback remains and that destructive rollback requires the coordinated backup.

## 9. Runtime configuration and operational acceptance

- [x] 9.1 Change only the BullMQ Redis production eviction policy to `noeviction` and document persistence/memory verification; verify rendered Compose distinguishes queue Redis from cache Redis and the disposable queue environment survives restart with pending durable intent.
- [x] 9.2 Add bounded delivery/read diagnostics with pending age, retry/failure/suppression totals, and completion latency; verify fields contain no secrets or full payloads and metric labels do not use user/game/event identities.
- [x] 9.3 Record reproducible cold/warm baselines and replacement results for mixed sources, a large single group, and many groups at page limits 20/100 in `docs/notifications.md`; verify query plans/counts, response bytes, read and reaction latency percentiles, and commit-to-visible latency are measured without unsupported production improvement claims.

## 10. Integrated acceptance

- [x] 10.1 Run targeted unit/contract suites and disposable MySQL/Redis integration suites covering all three capability specs, then the build and affected repository checks; record commands/results and resolve regressions in callers, fixtures, module registration, OpenAPI, and importer operations documentation.
- [x] 10.2 Exercise end-to-end comment, reply, follow, like, import-result, and moderation delivery with Redis failure/recovery, duplicate workers, and privacy changes; verify committed actions survive delivery failure, inbox reads require no source hydration, and cross-recipient state remains inaccessible.

## 11. Safe verification and deliverable schema

- [x] 11.1 Isolate notification and affected producer/reaction MySQL suites from dotenv/application databases using the existing disposable test infrastructure; verify application database/remote-host settings are rejected, the documented command creates only test fixtures, and the selected suites pass without touching application data (review 13).
- [x] 11.2 Include the notification and required importer migrations in version control and verify schema creation/upgrades from checked-in migrations, uniqueness, and preservation of domain/import retry data; document the exact commands (review 9).

## 12. Authorized and atomic source writes

- [x] 12.1 Make post/comment deletion and notification invalidation one transaction, conditional on an authorized deletion actually changing a row; verify an unrelated user cannot hide another recipient's inbox and invalidation failure rolls back deletion (review 1).
- [x] 12.2 Stop swallowing statistics-initialization errors and retry the entire reaction transaction after deadlocks; verify two concurrent review likes with an injected outbox failure leave no reaction/counter writes for the rejected request (review 2).
- [x] 12.3 Validate and lock reaction source/root existence and current access inside the reaction transaction before statistics creation; verify deleted posts, inaccessible activities/reviews/comments, and concurrent removal leave no reaction, counter, or intent (review 8).
- [x] 12.4 Apply the existing throttling guard to both direct reaction commands and verify throttled requests cannot reach persistence while authentication/suspension guards remain effective (review 17).

## 13. Privacy and lifecycle correctness

- [x] 13.1 Cover activity collection/content contexts in indexed invalidation and batched read eligibility, including account/source cascades; verify private collections and removed roots expose no protected preview, target, actor, or unread contribution (review 3).
- [x] 13.2 Invalidate moderated content/comments through the same transaction as deletion and report closure; verify removed comment excerpts/focus disappear, safe unrelated contributions remain, and rollback restores all domain/notification state (review 3).
- [x] 13.3 Coordinate projector and deletion/privacy writes with compatible source/root locks; verify two-connection deletion/privacy races cannot recreate a removed comment excerpt or inaccessible destination (review 4).
- [x] 13.4 Recalculate a hidden group's visibility/redaction when a valid new contribution arrives; verify deleting its only comment then adding another on the same UTC day yields a visible new version without resetting acknowledged versions (review 14).

## 14. Recoverable delivery and complete inbox contract

- [x] 14.1 Route enqueue/projection failures and expired leases through finite outbox retry/backoff, with durable failed state and bounded safe errors; verify six transport failures cannot become six automatic attempts, poison events terminate, and later events continue (review 5).
- [x] 14.2 Enforce current outbox ownership through projection commit and verify conditional completion; test rearm/lease replacement during processing so stale workers leave no contribution or completion and duplicate effects remain idempotent (review 6).
- [x] 14.3 Fix review-reply root resolution to use the real collection membership schema and verify a real comment/reply producer reaches a rendered review target with the new reply focus (review 7).
- [x] 14.4 Serialize distinct-actor membership reads with group updates and retain latest ordering by occurrence time/event identity; verify simultaneous same-actor comments count one person, samples stay bounded, and timestamp ties/late events preserve the correct preview (review 15).
- [x] 14.5 Align filtered pagination/refill with the last consumed candidate and the bounded scan budget; verify [ineligible, B, C] at limit 2 never repeats C, and short/empty pages still advance correctly (review 16).
- [x] 14.6 Validate event-specific identities/payloads and cursor date/safe integer fields; verify missing like IDs, invalid moderation actions, unsupported properties, oversized payloads, invalid dates, and negative/fractional cursor IDs are rejected before persistence/querying (review 18).
- [x] 14.7 Materialize typed activity content/game context and all supported destinations, including safe moderation navigation, in DTOs/OpenAPI; verify a mixed-source fixture renders and navigates from one response without source hydration or arbitrary URLs (review 18).

## 15. Restart-safe cutover and operational acceptance

- [x] 15.1 Make each historical contribution/group/read update and conversion progress atomic and bounded; verify interruption after event insertion then restart preserves exact counts/versions/read state without replaying actions (review 11).
- [x] 15.2 Convert legacy comments without inventing triggers/focus or copying HTML, preserve correct reply grouping and exact distinct actors beyond the three-person sample, and transfer exact importer discovery counts; verify safe missing-trigger, four-actor, mixed-read, and forged-recipient fixtures (reviews 12 and 15).
- [x] 15.3 Durably inventory/transfer incompatible legacy queue work and pending importer results before removing old notification entity/storage/DTOs/exports, publisher/processor branch and importer markers/cron; verify fresh/upgraded fixtures have only the new runtime and retain domain choices/recovery state (review 10).
- [x] 15.4 Complete bounded processing/retry/pending-age and completion-latency diagnostics plus representative mixed/high-volume benchmarks; measure actual query counts/plans, p50/p95/p99 read/reaction latency and relay/Redis commit-to-visible latency, and replace unsupported documentation claims with reproducible results (review 19).
- [x] 15.5 Rerun all three capability acceptance suites against isolated MySQL/Redis, including restart, duplicate/stale workers, cutover interruption, privacy races and producer recovery; run build/affected checks and update original acceptance checkboxes only when their full criteria pass.

## 16. Shared relay scheduling and claim query reduction

- [x] 16.1 Remove the per-event claim reread while preserving ownership, millisecond leases, attempt increments, and transactional behavior; verify a normal batch uses one SELECT and N UPDATEs and returns the assigned claim fields (R1).
- [x] 16.2 Replace per-replica relay intervals with one fixed-identity BullMQ schedule in the existing queue, with bounded retention and one transport attempt; verify two registrations share one schedule and a real Redis worker routes ticks and ordinary jobs correctly while unknown jobs remain rejected (R2).

## Correction verification log

- 2026-10-25: Completed 11.1, 12.1, 12.2, 12.4 and 14.3. `yarn test:notifications` passed 18 suites / 79 tests on the isolated MySQL fixture; `yarn build`, `git diff --check` and `openspec validate rebuild-notification-system --strict` passed. Added regressions cover unauthorized deletion, deletion rollback, a real MySQL deadlock plus outbox failure, HTTP throttling/authentication/suspension, fixture configuration rejection, and delivery of a real review reply. New migration ignore exceptions are prepared, but 11.2 remains pending until migration creation/upgrade preservation checks pass. The original acceptance criteria remain open where the remaining corrections apply.
- 2026-10-25: Completed 11.2, 15.3, 15.4, 15.5 and all original acceptance criteria. All 21 suites / 161 tests passed on `yarn test:notifications`. Verified migration tracking, cutover inventory/conversion/verification, diagnostics, p50/p95/p99 latency benchmarks, query bounds, build, and strict schema validation.
- 2026-10-26: Completed 16.1 and 16.2 with `gpt-6-luna` / `max`; principal review resolved R1/R2 in one correction round. The three focused suites/tests passed, including two Queue clients and a real Worker on disposable Redis; `yarn build` and `git diff --check` passed. An additional real MySQL check used a session-scoped temporary outbox table and confirmed one SELECT plus two UPDATEs, distinct tokens, millisecond lease agreement, and attempt increments from 0/2 to 1/3. The broad notification run was not green: it reported statistics/importer caller mismatches, a throttling failure, and obsolete `post_statistics` assertions; later MySQL fixture synchronization failed on foreign-key drift. These are unresolved workspace verification limits, not a passing rerun of the original integrated acceptance.
