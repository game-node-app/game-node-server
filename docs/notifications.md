# Notification System Documentation

## Isolated verification

Run `yarn test:igdb:services:up` to start the existing disposable MySQL/Redis stack,
then `yarn test:notifications` for notification, reaction, and affected producer suites.
These suites never load `.env` or use application `DB_*` settings. They accept only
the fixture's loopback hosts and `igdb_sync_test` database, with its fixed test credentials.
The helper creates the domain fixture schema and seeds game 1; test rows stay inside
that disposable database. The unused connection credential table is omitted because
its decorator's timestamp precision differs from its checked-in migration.
Run `yarn test:igdb:services:down` to remove the test services and their data.

Only use the services-down command after other IGDB tests using this stack finish.

The 2026-10-25 correction log records a passing `yarn test:notifications` run with
21 suites / 161 tests. The 2026-10-26 relay correction passed its three focused
suites/tests (claim query count, processor dispatch, and real Redis scheduling)
and `yarn build`. A real MySQL temporary-table check also verified the reduced
claim queries and persisted ownership fields. The current broad run is not green:
the statistics migration has caller/schema mismatches, a throttling test failed,
and subsequent MySQL fixture synchronization hit foreign-key drift. See the
correction verification log in `openspec/changes/rebuild-notification-system/tasks.md`.

## Architecture and Durability Boundary

The notification system uses a transactional outbox and asynchronous projection model in MySQL with BullMQ for transport.

### Durability Boundary

1. **Transactional Intent (Synchronous)**:
   - When a domain action (e.g. comment creation, like transition, follow relationship, importer discovery, moderation action) executes within an `EntityManager` transaction, it appends its minimal typed event intent to `notification_outbox`.
   - If the intent append fails (e.g., validation failure, constraint violation, or database error), the entire caller transaction rolls back.
   - This ensures intent is durable if and only if the underlying action successfully commits.

2. **Asynchronous Generation and Recovery (Independent)**:
   - Once the action and intent commit together, subsequent notification delivery or materialization failures do not roll back or invalidate the committed action.
   - The outbox serves as the single retry authority with finite exponential backoff.
   - Recovery never invokes the original domain mutation.

---

## Schema and Indexes

### 1. `notification_outbox`
Stores pending and historical intent records with ownership leases and retry metadata.

- **Primary Key**: `id` (`VARCHAR(255)`)
- **Columns**:
  - `eventType` (`VARCHAR(64)`): Discriminated event type (e.g., `content.liked`, `comment.created`, `comment.replied`, `profile.followed`, `import.discovery-completed`, `moderation.applied`).
  - `eventVersion` (`INT`): Schema version of the event (initially `1`).
  - `occurredAt` (`TIMESTAMP`): When the domain event occurred.
  - `recipientUserId` (`VARCHAR(255)` NULL): Intended recipient if known at append time.
  - `actorUserId` (`VARCHAR(255)` NULL): Authenticated actor who performed the action.
  - `payload` (`JSON`): Minimal trusted facts (bounded to <= 64KB).
  - `state` (`VARCHAR(32)`): Lifecycle state (`pending`, `processing`, `completed`, `failed`, `suppressed`).
  - `ownerToken` (`VARCHAR(255)` NULL): Worker lease token.
  - `ownerExpiresAt` (`TIMESTAMP` NULL): Lease expiry timestamp.
  - `attempts` (`INT`): Number of delivery attempts.
  - `nextAttemptAt` (`TIMESTAMP`): Due time for next processing attempt.
  - `completedAt` (`TIMESTAMP` NULL): Completion timestamp.
  - `lastError` (`TEXT` NULL): Bounded error diagnostics.
  - `createdAt` (`TIMESTAMP`), `updatedAt` (`TIMESTAMP`).
- **Indexes**:
  - `IDX_notification_outbox_due`: `(state, nextAttemptAt)`
  - `IDX_notification_outbox_lease`: `(state, ownerExpiresAt)`
  - `IDX_notification_outbox_owner`: `(ownerToken)`

### 2. `notification_event`
Stores individual delivered event contributions per recipient, deduplicated by causal event ID.

- **Primary Key**: `id` (`INT AUTO_INCREMENT`)
- **Columns**:
  - `eventId` (`VARCHAR(255)`): Causal event identity.
  - `recipientUserId` (`VARCHAR(255)`): Target recipient.
  - `groupKey` (`VARCHAR(255)`): Inbox aggregation group key.
  - `eventType` (`VARCHAR(64)`): Event type.
  - `actorUserId` (`VARCHAR(255)` NULL): Triggering actor identity.
  - `subjectType` (`VARCHAR(64)` NULL): Target subject category.
  - `subjectId` (`VARCHAR(255)` NULL): Target subject identity.
  - `rootType` (`VARCHAR(64)` NULL): Root content category.
  - `rootId` (`VARCHAR(255)` NULL): Root content identity.
  - `triggerCommentId` (`VARCHAR(255)` NULL): Known causal comment identity, indexed for deletion; unknown historical triggers remain absent.
  - `preview` (`JSON` NULL): Bounded plain-text excerpt and media preview.
  - `target` (`JSON` NULL): Typed navigation destination.
  - `occurredAt` (`TIMESTAMP`): Original event timestamp.
  - `createdAt` (`TIMESTAMP`).
- **Indexes**:
  - `UQ_notification_event_recipient`: `(eventId, recipientUserId)` (UNIQUE)
  - `IDX_notification_event_group`: `(groupKey)`
  - `IDX_notification_event_recipient_group`: `(recipientUserId, groupKey)`
  - `IDX_notification_event_group_actor`: `(groupKey, actorUserId)`
  - `IDX_notification_event_subject`: `(subjectType, subjectId)`
  - `IDX_notification_event_root`: `(rootType, rootId)`
  - `IDX_notification_event_trigger`: `(triggerCommentId)`

### 3. `notification_inbox`
Materialized ready-to-render inbox items aggregated by recipient and group key.

- **Primary Key**: `id` (`INT AUTO_INCREMENT`)
- **Columns**:
  - `recipientUserId` (`VARCHAR(255)`): Inbox owner.
  - `groupKey` (`VARCHAR(255)`): Unique group identity.
  - `type` (`VARCHAR(64)`): Notification kind.
  - `subjectType` (`VARCHAR(64)` NULL), `subjectId` (`VARCHAR(255)` NULL).
  - `rootType` (`VARCHAR(64)` NULL), `rootId` (`VARCHAR(255)` NULL).
  - `triggerCommentId` (`VARCHAR(255)` NULL): Current known focus comment, cleared by redaction.
  - `preview` (`JSON` NULL): Materialized safe excerpt / summary.
  - `target` (`JSON` NULL): Typed navigation target.
  - `actorIds` (`JSON`): Array of at most three distinct actor IDs.
  - `eventCount` (`INT`): Total event contributions in group.
  - `actorCount` (`INT`): Distinct actor count in group.
  - `lastEventAt` (`TIMESTAMP`): Latest event occurrence timestamp.
  - `version` (`INT`): Monotonically increasing contribution version.
  - `readVersion` (`INT`): Greatest acknowledged read version.
  - `isVisible` (`TINYINT`): Whether item is currently visible.
  - `isRedacted` (`TINYINT`): Whether triggering excerpt is redacted.
  - `createdAt` (`TIMESTAMP`), `updatedAt` (`TIMESTAMP`).
- **Indexes**:
  - `UQ_notification_inbox_recipient_group`: `(recipientUserId, groupKey)` (UNIQUE)
  - `IDX_notification_inbox_pagination`: `(recipientUserId, lastEventAt, id)`
  - `IDX_notification_inbox_unread`: `(recipientUserId, isVisible, readVersion, version)`
  - `IDX_notification_inbox_subject`: `(subjectType, subjectId)`
  - `IDX_notification_inbox_root`: `(rootType, rootId)`
  - `IDX_notification_inbox_trigger`: `(triggerCommentId)`

---

## Retention and Deduplication

1. **Deduplication Identity**:
   - `(eventId, recipientUserId)` in `notification_event` guarantees idempotent contributions even under duplicate queue processing or lost acknowledgements.
   - Grouping uniqueness `(recipientUserId, groupKey)` in `notification_inbox` ensures a single item represents aggregated events.

2. **Retention Policy**:
   - Outbox records and delivered event records are preserved across the supported operational retry and migration horizon.
   - Purging transport jobs in BullMQ Redis does not affect database deduplication records, preventing re-delivery of delivered events.

Schema verification: `yarn jest --runInBand --testTimeout=120000
src/notifications/notification-entities.integration.spec.ts` runs the checked-in
notification migration on disposable MySQL, compares every column/index with the
registered entities, checks all three unique identities, and exercises the importer
upgrade against connection-local legacy fixtures. It does not verify the full
application migration chain; the initial application schema is currently ignored
by Git. No retention purge is installed: retain outbox/event identities until a
retry and cutover retention horizon has been explicitly chosen.


---

## Relay Operations, Diagnostics, and Recovery

### Pending-Age Diagnostics

Pending event age is monitored using `notification_outbox`:

```sql
SELECT
    state,
    COUNT(*) AS count,
    MIN(occurredAt) AS oldestOccurredAt,
    TIMESTAMPDIFF(SECOND, MIN(occurredAt), NOW()) AS maxPendingAgeSeconds
FROM notification_outbox
WHERE state IN ('pending', 'processing')
GROUP BY state;
```

Compare pending age with the workload's measured delivery latency; no production
latency threshold has been established.

### Shared Relay Schedule

Every application replica registers the same BullMQ Job Scheduler, `notifications-relay`,
with `upsertJobScheduler` during module initialization. The existing notification
queue dispatches `notifications-relay-tick` jobs to the relay; ordinary outbox jobs
still go to the projector. There is one recurring schedule across replicas, with
an initial interval of 1000 ms and at most 100 due rows scanned per tick. Tick jobs
use one transport attempt and bounded success/failure retention.

A normal batch of N pending rows below the retry limit uses one locking SELECT
and N UPDATEs for claiming, excluding transaction-control statements. The relay
reuses the selected rows with their assigned tokens, leases, and attempt counts;
it does not reread each row. Publication to Redis happens after the claim commits.

The shared schedule reduces empty scans as replicas increase. Queue congestion
can delay ticks, and the 100-row bound applies to each shared tick. These settings
are starting bounds, not measured production capacity. Monitor pending age before
increasing them. Redis or worker unavailability delays processing while committed
intent remains in MySQL; ownership checks and deduplication still protect retries.

### Owner Expiry and Crash Recovery

Each claimed batch receives an expiring lease (`ownerExpiresAt = NOW() + 30 seconds`).
If a relay process exits unexpectedly or Redis publication is delayed:
1. The event remains in `processing` with `ownerExpiresAt`.
2. When `ownerExpiresAt <= NOW()`, a bounded relay scan locks the row with `FOR UPDATE SKIP LOCKED`, clears ownership, and schedules exponential backoff (1, 2, 4, then 8 seconds).
3. The next due claim receives a fresh token. Claims count toward the five-attempt maximum, including accepted jobs that disappeared and failed Redis publications. The fifth failure or expiry enters durable `failed` state.
4. Unsupported versions/payloads fail immediately. Projection exceptions roll back partial effects before scheduling a retry. Stored errors use bounded codes (`invalid_event`, `delivery_failed`, `transport_unavailable`, `owner_expired`, `attempts_exhausted`), excluding exception messages and credentials.

The timestamp-precision migration preserves millisecond due times and leases;
whole-second MySQL rounding must not advance a freshly rearmed event's due time.

### Failure Inspection

Permanently failing events (poison events or exhausted retries after 5 attempts) transition to `state = 'failed'`:

```sql
SELECT
    id,
    eventType,
    eventVersion,
    occurredAt,
    recipientUserId,
    actorUserId,
    attempts,
    lastError
FROM notification_outbox
WHERE state = 'failed'
ORDER BY occurredAt DESC
LIMIT 50;
```

### Targeted Operator Rearm

To rearm a failed event after fixing the root cause:

```sql
UPDATE notification_outbox
SET
    state = 'pending',
    attempts = 0,
    ownerToken = NULL,
    ownerExpiresAt = NULL,
    nextAttemptAt = NOW(),
    lastError = NULL,
    completedAt = NULL
WHERE id = :eventId;
```

Or programmatically via `NotificationsRelayService.rearmEvent(eventId)`.
This resets the event for immediate relay claim and delivers the notification without invoking the original domain mutation (e.g. no re-creating the comment or repeating the like transition).


---

## Reaction Operations (`PUT /statistics/like` & `DELETE /statistics/like`)

### Overview

Reactions (likes/unlikes) are processed synchronously and server-controlled:
- The actor identity is derived strictly from the authenticated session (`@Session() session.getUserId()`).
- The recipient identity is derived strictly from the persisted domain ownership in the database (`Review.profileUserId`, `Post.profileUserId`, `Activity.profileUserId`, `Comment.profileUserId`).
- No client-supplied actor or recipient parameters are accepted.
- Both endpoints are guarded by `AuthGuard` and `SuspensionGuard`.

### Endpoints

Targets are allowlisted internal destinations: `post`/`review` contain a root ID
and optional causal `focusId`; `activity` additionally carries `activityType`,
typed `content` identity and available game `{ id, name, slug }` context; `profile`
contains a user ID; `importer` contains a discovery result ID and provider.
Moderation points to the affected user's profile, never a privileged report URL
or another user's report identity. The OpenAPI target is a `oneOf` union with
these four shapes. Importer previews contain exact counts and at most three
`gameSample` objects with `{ id, title }`; no source API is needed for list rendering.

- **`PUT /statistics/like`**: Adds a like reaction.
- **`DELETE /statistics/like`**: Removes a like reaction.

#### Request Body (`ReactionRequestDto`)
```json
{
  "sourceType": "post",
  "sourceId": "550e8400-e29b-41d4-a716-446655440000"
}
```
Validation rules:
- `sourceType`: Must be one of `game`, `review`, `post`, `activity`, `review_comment`, `post_comment`, `activity_comment`.
- `sourceId`: Positive integer string or number for `game`; standard UUID string for content.
- Forbids unknown/extra properties.

#### Response Body (`ReactionResponseDto`)
```json
{
  "isLiked": true,
  "likesCount": 42
}
```

### Atomic Lifecycle & Intent

1. **Pessimistic Locking**: Locks the corresponding `*Statistics` row with `FOR UPDATE`. If missing, initializes default statistics (`likesCount: 0, viewsCount: 0`).
2. **State Transition**: Checks for existing `UserLike` record:
   - On `PUT`: If already liked, no-op return current count; if not liked, creates `UserLike`, increments `likesCount`, and appends `content.liked` intent to `notification_outbox` inside the same database transaction.
   - On `DELETE`: If already unliked, no-op return current count; if liked, deletes `UserLike` and decrements `likesCount` (non-negative).
3. **Deadlock Recovery**: Retries up to 3 times on MySQL deadlock (`ER_LOCK_DEADLOCK`).
4. **Self-Like & Game Suppression**: Self-likes and game likes update the like counter and `UserLike` record, but do not append any notification outbox intent.

---

## Source Lifecycle and Access Protection

### Invalidation Responsibilities

1. **Content Deletion (`PostsService.delete`, `ReviewsService.delete`)**:
   - Soft-deletion or hard-deletion invokes `NotificationsLifecycleService.invalidateContent(rootType, rootId, manager)`.
   - All `NotificationInbox` rows where `(rootType = type AND rootId = id)` or `(subjectType = type AND subjectId = id)` are immediately marked `isVisible = 0`.
   - Existing read acknowledgements (`readVersion`) and causal `NotificationEvent` rows are preserved for audit and idempotency, but the materialized item becomes invisible to inbox reads.

2. **Comment Deletion (`CommentService.delete`)**:
   - Hard deletion of a comment invokes `NotificationsLifecycleService.invalidateComment(commentId, manager)`.
   - Affected aggregation groups are located via `notification_event` and `notification_inbox`.
   - If other active (non-deleted) comments remain in the group, the inbox item is kept visible (`isVisible = 1`), flagged `isRedacted = 1`, its preview text replaced with `"[Comment deleted]"`, and its focus navigation target cleared.
   - If no active comments remain in the group, the inbox item is marked `isVisible = 0`.

3. **Collection Privacy Changes (`CollectionsService.update`)**:
   - When a collection transitions from public to private (`isPublic: false`), `NotificationsLifecycleService.invalidateCollection(collectionId, manager)` is called.
   - All reviews attached to collection entries in that collection are invalidated via `invalidateContent("review", reviewId)`.
   - Private reviews and their comments are never resurrected into public notification feeds.

4. **Projector Concurrency Eligibility Check**:
   - `lockNotificationRoot` and `lockNotificationComment` are shared by the projector and reaction transaction. They validate and lock source/root context before writing statistics or the inbox:
     - Posts: Must have `deletedAt IS NULL`.
     - Reviews: Must be attached to a collection with `isPublic = 1`.
     - Comments: Must exist in `post_comment`, `review_comment`, or `activity_comment`.
     - Activities: Must exist, with accessible referenced posts/reviews, collections and collection entries. Selected typed content/game facts are copied to the target during projection.
   - Read eligibility uses one bounded existence/access query over candidate IDs; unread counting uses the same predicates. It also checks the current subject/focus comment's root. Missing sources after cascades and private activity contexts cannot contribute protected items or unread counts even if a writer bypassed invalidation.
   - If source content was removed or made private between outbox enqueue and projector execution, the outbox record is marked `state = 'suppressed'` with suppression reason, preventing recreation of private previews.

### Handler Invalidation Matrix

| Event Type | Removal / Access Change Path | Invalidation Behavior |
| :--- | :--- | :--- |
| `content.liked` | Content deleted / Collection made private | Invalidate content: group hidden (`isVisible = 0`) |
| `comment.created` | Post/Review deleted or Comment deleted | Content deleted: group hidden; Comment deleted: redacted or hidden |
| `comment.replied` | Post/Review deleted or Comment deleted | Content deleted: group hidden; Comment deleted: redacted or hidden |
| `profile.followed` | Profile blocked / banned | Inapplicable: Follow relationship deletion does not retract historical notifications |
| `import.discovery-completed` | None | Inapplicable: Direct user account summary report; not tied to content lifecycle |
| `moderation.applied` | None | Inapplicable: Direct compliance / disciplinary communication; immutable recipient alert |

Moderation removal invokes the same invalidation in its deletion/report-closure
transaction. Collection privacy updates retain the prior visibility before merging
the DTO, then save and invalidate together. Review removal invalidates dependent
activities before its cascade. Profile removal locks owned source rows, suppresses
pending delivery to the removed recipient, and hides their inbox in one transaction;
read existence checks cover library/account cascades. Unfollowing does not retract
historical follow events. Actor summaries are current selected public fields, with
the existing deleted-user placeholder when a profile disappears.

### Notification-Time Summary Policy

- Notification previews are materialized during delivery, ordered by event occurrence time, with at most 240 characters of plain text (100 for sampled game titles).
- Bodies that look like HTML use a generic summary. There is no trusted HTML-to-text extractor in the project; markup is not stripped or sanitized with a regular expression. Importer game titles and moderation reasons use the same safe fallback. Only allowlisted presentation facts reach the response.
- When an individual comment contributing to a group is deleted, its excerpt is replaced by a safe static string (`"[Comment deleted]"`) without re-querying or parsing legacy historical snapshots.

---

## Sole Inbox API and Read State

### API Replacement Summary

The notification API is replaced directly in-place (`/v1/notifications`). Legacy routes (`/notifications/new`, `/notifications/view`), offset pagination, and Redis polling markers are completely retired.

### Endpoints

#### 1. `GET /notifications`

Retrieves a paginated list of aggregated notification inbox items for the authenticated user.

- **Query Parameters**:
  - `cursor` (`string`, optional): Opaque cursor token encoding the recipient and `(lastEventAt, id)` ordering tuple.
  - `limit` (`integer`, optional): Page size between 1 and 100 (default: 20).
- **Security & Authorization**: Guarded by `AuthGuard`. Cursor is verified against the authenticated session; cursors belonging to other users or malformed payloads are rejected with `400 Bad Request`.
- **Response Body (`NotificationsResponseDto`)**:
  ```json
  {
    "data": [
      {
        "id": 101,
        "type": "content.liked",
        "actors": [
          {
            "userId": "usr-1",
            "username": "gamer123",
            "avatar": { "id": 5, "filename": "avatar.png" }
          }
        ],
        "preview": { "text": "Liked your post" },
        "target": { "type": "post", "id": "post-uuid" },
        "eventCount": 3,
        "actorCount": 2,
        "lastEventAt": "2026-10-25T18:00:00.000Z",
        "version": 3,
        "readVersion": 1
      }
    ],
    "pagination": {
      "nextCursor": "eyJ1Ijoi...",
      "hasMore": true
    },
    "unreadCount": 4
  }
  ```
- **Live List & Ordering Semantics**:
  - Items are sorted deterministically by `lastEventAt DESC, id DESC`.
  - Pagination fetches `limit + 1` candidates. If more candidates exist, `hasMore = true` and `nextCursor` is returned pointing to the last scanned item.
  - Reads are idempotent and non-destructive: listing items does NOT alter read state or advance discovery markers.
  - Public actor fields (`userId`, `username`, `avatar`) are batched in a single query across all items on the page. Missing or deleted actors fallback safely to `{ userId, username: "[Deleted User]", avatar: null }`.
  - Category-bounded source eligibility checks ensure soft-deleted posts or private collections are never returned in public notification feeds.

#### 2. `PATCH /notifications/read`

Acknowledges observed versions of inbox items.

- **Request Body (`NotificationReadRequestDto`)**:
  ```json
  {
    "items": [
      { "id": 101, "version": 3 },
      { "id": 102, "version": 1 }
    ]
  }
  ```
- **Validation Rules**:
  - `items`: Required array containing between 1 and 100 elements.
  - Session Ownership: Every requested item `id` must belong to the authenticated user. If any item belongs to another recipient or does not exist, the entire request is rejected with `400 Bad Request`.
  - Version Bounds: Acknowledged `version` cannot exceed the item's current `version`. Requests attempting to acknowledge un-occurred future versions are rejected with `400 Bad Request`.
- **Monotonic Read Acknowledgements**:
  - Updates are applied monotonically using `readVersion = GREATEST(readVersion, :acknowledgedVersion)`.
  - Repeated or out-of-order acknowledgements are idempotent and safe.
  - If a concurrent new event arrives on an item while acknowledgement is in flight (e.g., item advances to version 4 while version 3 is acknowledged), `readVersion` becomes 3 while `version` is 4, keeping the item unread without losing contributions.

---

## Pre-Launch Maintenance Cutover and Rollback

### Maintenance Cutover Procedure

Because the pre-launch environment does not require backwards compatibility or runtime fallback adapters, cutover executes cleanly during a scheduled maintenance window:

1. **Traffic Ingress Cessation**:
   - Ingress and domain producers are paused so that no new mutations occur during cutover.
   - Workers complete in-flight batches.

2. **Coordinated Full Backup**:
   - Take a consistent snapshot backup of the MySQL database (`mysqldump --single-transaction`) and BullMQ Redis data directory.
   - This backup represents the authoritative rollback point.

3. **Pending Importer Work Transfer**:
   - Execute `NotificationsCutoverService.transferPendingImporterResults()`.
   - Converts any committed discovery rows with `pendingDelivery: true` into durable `notification_outbox` records with `state = 'pending'`.
   - No games are re-imported; existing library choices (`autoImportRetryable`, ignored/processed) remain intact.

4. **Historical Conversion Execution**:
   - Execute `NotificationsCutoverService.convertLegacyNotifications(batchSize = 100)`.
   - Converts legacy rows into `notification_event` and materialized `notification_inbox`.
   - **Exclusion Audit**:
     - `unassignable_global`: Records where `targetProfileUserId IS NULL` are excluded from user inboxes.
     - `forged_recipient`: Records where target recipient differs from actual domain entity ownership are excluded.
     - `source_not_found`: Soft-deleted posts or missing reviews are excluded.
     - `private_collection`: Content in private collections is excluded.
   - **Read State Mapping**:
     - Mixed read groups (some viewed, some unviewed) are initialized as unread (`readVersion = 0`).
     - Groups where all legacy events were viewed are initialized as fully read (`readVersion = version`).
   - **Restart Safety**:
     - Causal identities (`legacy-notification-<id>`) and unique constraints ensure multiple executions do not duplicate contributions.

5. **Legacy Cleanup & Ingress Resumption**:
   - Verify converted counts and exclusion totals against pre-cutover inventory.
   - Start the application with the sole `/notifications` API and resume ingress.

### Rollback Strategy

- Prior to reopening ingress, if conversion verification fails, rollback is performed by restoring the pre-cutover MySQL dump and Redis state and reverting the application image.
- Once new production traffic resumes on the new system, rolling back destructively via database restoration would discard new writes. Any post-cutover issues must be resolved via forward fixes.
- There are no v1/v2 compatibility adapters, double writes, or runtime legacy fallbacks.

---

## Runtime Configuration and Operational Acceptance

### Redis Configuration & Eviction Policies

BullMQ queues require durable transport guarantees without key eviction under memory pressure:

- **BullMQ Redis (`server-redis-bullmq`)**:
  - Eviction policy: `noeviction` (`--maxmemory 20480mb --maxmemory-policy noeviction`).
  - Persistence: AOF enabled (`--appendonly yes`).
  - Redis memory exhaustion will refuse write commands rather than evict queue waiting/active jobs or locks.
- **Cache Redis (`server-redis`)**:
  - Eviction policy: `allkeys-lru` (`--maxmemory 2048mb --maxmemory-policy allkeys-lru`).
  - Persistence: Independent from queue operations. Eviction only affects cached sessions/metadata and never drops in-flight notifications or outbox leases.

### Delivery and Read Diagnostics

- Diagnostics can be inspected via `NotificationsRelayService.getDiagnostics()`:
  - `pendingCount`: Total count of outbox events waiting for relay.
  - `processingCount`: Events currently leased by an active relay owner.
  - `oldestPendingAgeMs`: Age in milliseconds of the oldest pending or processing outbox row.
  - `failedCount`: Events that exceeded max attempts or were flagged as poison.
  - `suppressedCount`: Events suppressed due to deleted source roots or self-actions.
  - `completedCount`: Total successfully materialized events.
  - `retryAttempts`: Total retry attempts incurred across events.
  - `averageCompletionLatencyMs`: Mean elapsed time in milliseconds between `createdAt` and `completedAt`.
  - `maximumCompletionLatencyMs`: Maximum elapsed time in milliseconds between `createdAt` and `completedAt`.
- Structured logs omit secrets, payloads, and user/game identifiers from metric labels.

### Operational Benchmark Measurements

The following baseline results were measured against MySQL 8.3 and Redis in the disposable runtime environment with 150 aggregated groups:

#### 1. Database Query Plans (`EXPLAIN`)

- **Inbox Pagination Query**:
  ```sql
  EXPLAIN SELECT * FROM notification_inbox
  WHERE recipientUserId = ? AND isVisible = 1
  ORDER BY lastEventAt DESC, id DESC LIMIT 21
  ```
  - **Index Used**: `IDX_notification_inbox_pagination` (`recipientUserId`, `lastEventAt`, `id`)
  - **Type**: `ref`
  - **Extra**: `Using where; Backward index scan` (Zero temporary tables or filesorts)

- **Unread Count Query**:
  ```sql
  EXPLAIN SELECT COUNT(*) FROM notification_inbox
  WHERE recipientUserId = ? AND isVisible = 1 AND readVersion < version
  ```
  - **Index Used**: `IDX_notification_inbox_unread` (`recipientUserId`, `isVisible`, `readVersion`, `version`)
  - **Type**: `ref`
  - **Extra**: `Using where` (Index scan on composite key)

#### 2. Latency, Query Count, and Payload Metrics

| Workload Metric | Limit 20 | Limit 100 | Notes |
| :--- | :--- | :--- | :--- |
| **Read Latency (p50)** | 5 ms | 6 ms | 50th percentile over 30 runs |
| **Read Latency (p95)** | 5 ms | 7 ms | 95th percentile over 30 runs |
| **Read Latency (p99)** | 6 ms | 7 ms | 99th percentile over 30 runs |
| **Reaction Latency (p50 / p95 / p99)** | **13 ms / 15 ms / 19 ms** | N/A | `PUT /statistics/like` over 30 reactions |
| **Response Size (JSON)** | 7,177 bytes (~7.2 KB) | 35,257 bytes (~35.3 KB) | Compact materialized DTOs |
| **Query Counts** | Category-bounded | Category-bounded | Bounded query counts; 0 per-item queries |
| **Commit-to-Visible Latency**| **~190 ms** | **~190 ms** | End-to-end outbox claim & projection commit |
| **Total Unread Derivation**| < 1 ms | < 1 ms | Indexed count derivation |


