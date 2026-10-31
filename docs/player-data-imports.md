# Player data imports

## Queue ownership and retention

`ImporterWatchModule` owns `importer-watch-queue`, whose job name is
`importer-watch-job`. `GameAchievementSyncModule` owns `game-achievement-sync`,
with the Steam, PlayStation, and Xbox job names defined in
`game-achievement-sync.constants.ts`.

Both registrations explicitly retain completed jobs for up to one hour, capped
at 1,000, and failed jobs for up to seven days, capped at 1,000. BullMQ removes
older entries lazily when subsequent jobs finish; age is not a scheduled cleanup
guarantee. Five attempts and five-second backoff remain unchanged. Nest merges
queue options shallowly, so each local `defaultJobOptions` must include retention.
Playtime queue retention remains immediate removal on success or failure.

Importer runs use distinct owner-based IDs and durable database admission per
connection/account. Pending and active work share that admitted owner; terminal
completion/failure or expired-owner recovery releases it independently of retained
history. A retained legacy job
therefore cannot collide with a new generated run ID. Queue admission is awaited;
Redis failures propagate to schedulers and callers. Connection persistence occurs
before onboarding admission, so a failed enqueue can leave the saved connection
in place even though the HTTP request fails. Achievement service construction
performs no account-specific enqueue.

## Targeted legacy importer cleanup

Cleanup is optional diagnostic housekeeping after the queue fix, not a prerequisite
for generated run IDs. Never flush Redis, obliterate production queues, or delete
imported database records.

1. Use the deployment's `BULLMQ_REDIS_URL` host/port and its existing BullMQ prefix
   (default `bull`). Select only `importer-watch-queue`; verify the environment
   before changing anything.
2. Stop importer schedulers/workers and disable manual retries during maintenance.
   Wait for active jobs to drain. Preserve waiting, delayed, paused, active, and
   waiting-for-children jobs. Do not resume scheduling until cleanup is finished.
3. Inventory terminal jobs using `queue.getJobs(["completed"], start, end, true)`
   and separately `queue.getJobs(["failed"], start, end, true)` in pages of 100.
   Record candidate IDs before removal. Select only jobs whose name is exactly
   `importer-watch-job` and whose ID is exactly
   `importer-watch-${job.data.userId}-${job.data.source}`, with a nonempty string
   user ID and source equal to `steam`, `psn`, or `xbox`. Generated numeric run IDs
   and other job names are excluded.
4. Review the inventory. Immediately before each individual `job.remove()`, check
   `job.getState()` is still `completed` or `failed` and recheck name/identity.
   Abort on an unexpected transition or removal error. Maintenance isolation in
   step 2 prevents concurrent retries from changing terminal jobs into waiting
   work between the check and removal. Do not use `queue.clean()` because it
   cannot filter the legacy name/identity.
5. Confirm recorded waiting/delayed/paused job IDs remain present, no unrelated
   queues changed, and the next eligible importer job executes with a new ID.
   Restart workers/schedulers and restore manual retries.

## Focused verification

Queue composition tests invoke the installed Nest options factory from the real
module registrations with global removal defaults. They reproduced missing
retention before the fix and now verify retention plus attempts/backoff.

Run unit tests from the repository root:

```sh
yarn test --runInBand --testPathPatterns='(importer-watch|game-achievement-sync|playtime-watch|connections.service|player-data-queue.service).*spec.ts$'
```

For lifecycle integration, use a disposable local Redis instance:

```sh
docker run --rm -d --name player-import-test-redis -p 127.0.0.1:17379:6379 redis:8.10.3-alpine3.23
PLAYER_IMPORT_TEST_REDIS_PORT=17379 yarn test --runInBand --runTestsByPath src/sync/player-data/player-data-queue.lifecycle.spec.ts
docker stop player-import-test-redis
```

The integration suite uses a random BullMQ prefix and removes only that test
queue after closing its worker. It never flushes a database or touches another
prefix. It checks concurrent waiting duplicates, active duplicates, two successful
runs with retained history, and terminal failure retention using a two-job test
cap. Production caps are asserted separately by the queue composition tests.
Without `PLAYER_IMPORT_TEST_REDIS_PORT`, Redis integration tests are explicitly
skipped. No live provider account is needed for these tests.

## Provider completeness and pagination

Steam owned/recent responses may confirm zero games without a games array.
The transport normalizes only endpoint-specific explicit zero counts before the
installed SDK parses them. Missing arrays without that evidence, contradictory
nonempty arrays, and exposed errors remain failures. The installed-SDK fixture
covers both endpoints and the complete empty combined library.

Xbox MinutesPlayed batches contain at most 1,000 titles, without overlaps, and
advance even for an empty `statlistscollection` or empty `stats` array. Missing
or malformed collections and request failures reject the complete operation;
earlier batches are not returned as a successful partial snapshot. The 1,000
bound is the existing implementation's configured batch size; a measured provider
quota or independently verified service restriction is not claimed.

PSN trophy-title requests explicitly use limit 800, supported by the installed
`psn-api` source at `src/trophy/user/getUserTitles.ts`. Played-game requests retain
the existing limit 50; the installed client accepts `limit`/`offset` but does not
establish 50 as a provider maximum. Both paths advance by the actual returned
count and reject malformed/changing totals, repeated identities, skipping or
repeated continuation offsets, and empty pages while items remain. Zero total
with an empty array is normal success. Any later page failure rejects the entire
operation, preserving the caller's opportunity to retry instead of caching a
partial library.

Xbox obtained and available achievement requests use `maxItems: 1000` and
follow the returned `pagingInfo.continuationToken` query parameter. This contract
is documented for the
[achievement endpoint](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/live/rest/uri/achievements/uri-achievementsusersxuidachievementsgetv2).
Token exhaustion establishes completion; a short page does not. The
[PagingInfo contract](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/live/rest/json/json-paginginfo)
allows an unavailable total, so totals are checked when supplied (`totalRecords`
in the endpoint example/local type or `totalItems` in PagingInfo). Malformed
pages, repeated identities/tokens, changing totals, non-progress, inconsistent
terminal counts, and more than 1,000 pages reject the entire result. The item and
page bounds are application limits, not measured provider quotas.

PSN available and obtained trophy details request `"all"` groups with explicit
`offset` and `limit: 100`, advancing by actual returned count and checking
`totalItemCount` and optional `nextOffset`. Installed `psn-api` 2.11.0 declarations
and implementation (`dist/trophy/title/getTitleTrophies.d.ts`,
`dist/trophy/user/getUserTrophiesEarnedForTitle.d.ts`, and
`dist/psn-api.cjs.development.js`) expose and forward these parameters; 100 is an
application page size, not a verified provider maximum. Empty complete sets
succeed. Repeated trophy IDs, malformed/changing totals, skipping/repeated offsets,
empty pages with remaining items, and later request failures reject the complete
fetch. The obtained-achievement consumer propagates set failures before local
persistence instead of substituting an empty set. Complete empty arrays remain
cacheable; failed fetches do not cache a partial combined result.

Xbox TitleHub requests `maxItems: 5000` without fabricated cursor parameters and
processes at most the first 5,000 returned titles. Any structurally valid titles
array counts as a complete snapshot under this service's bound, including when
the array reaches the cap or unverified metadata signals additional titles.
Discovery and playtime process the bounded array, cache it as successful, and
advance their normal success timestamps. A missing titles array remains an
incomplete failure. Titles beyond the bound can remain undiscovered or
unrefreshed; absent titles never delete local rows. The importer HTTP response
keeps its existing pagination shape and includes candidates only from the
returned Xbox titles.

No verified continuation contract was found for this TitleHub route. The
[documented Xbox history/titles endpoint](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/live/rest/uri/titlehistory/uri-titlehistoryusersxuidhistorytitlesgetv2?view=gdk-2604)
supports paging but returns titles associated with achievement progress, so it
does not establish pagination for this full TitleHub library route. An
[open Microsoft documentation issue](https://github.com/MicrosoftDocs/xbox-live-docs/issues/53)
reports that continuation parameters do not appear to work on the TitleHub
route. Verify supported endpoint continuation against primary documentation or
captured multi-page responses before adding pagination. The TitleHub library
cache uses a new result-shape namespace; old entries are bypassed and expire
naturally. Unrelated cached services keep their existing keys and behavior.

Steam discovery and playtime share `getLibraryGames`, which requires both owned
and recent requests to succeed. It deduplicates app IDs, prefers recent entries,
and preserves distinct app IDs/editions and Family Sharing-only recent entries.
An empty owned result can use recent results; a failed/private required endpoint
is never silently converted to a complete snapshot. Missing last-played timestamps
remain eligible. The installed Steam client does not expose paging on these two
methods; no additional provider maximum is asserted.

Run the provider and propagation fixture suites with:

```sh
yarn test --runInBand --runTestsByPath src/sync/xbox/xbox-sync.service.spec.ts src/sync/psn/psn-sync.service.spec.ts src/sync/steam/steam-sync.service.spec.ts src/game/game-achievement/sync/game-achievement-sync.processor.spec.ts src/playtime/watch/playtime-watch.processor.spec.ts
```

These checks use provider fixtures, not live accounts. The installed PSN client
also returns decoded JSON without retaining HTTP status/headers and accepts no
abort signal. The library is retained: PSN in-flight cancellation, hard request/attempt duration
guarantees, and hidden HTTP status/header/Retry-After handling are out of scope.
Classify only exposed errors; ambiguous failures remain failed/incomplete. A
Promise timeout cannot cancel its request. Future attempt handling must check
deadlines between calls and ownership/deadlines before persistence, without
claiming that an in-flight PSN request or its network resources were cancelled.

## Provider failures, deadlines, and shared admission

Successful methods retain their existing array/object shapes. Complete empty
arrays are successful and cacheable. `ProviderSyncError.outcome` distinguishes
`unsupported`, `unavailable` (observable 401/403), `throttled` (observable 429),
`incomplete` (invalid/inconsistent snapshots), and other `failed` requests.
Unknown 404s and ambiguous PSN messages/codes are failures, not unsupported or
empty success. Steam's absent achievement schema supplies explicit unsupported
evidence; achievement display retains its existing no-achievements 404.

Failures retain their original cause for explicit internal inspection. Ordinary
error logging/serialization uses safe messages and operational fields, not raw
HTTP request config, credentials, or provider payloads. Xbox/Steam HTTP failures
retain status and Retry-After, including HTTP dates. Xbox authentication also
retains the status/headers exposed by its installed SDK. PSN keeps `psn-api` and
only reports observable errors; hidden HTTP statuses/headers are not inferred.

Cancellable Steam/Xbox data requests have a 30-second timeout and abort signal.
The existing Steam SDK still constructs and parses its endpoint requests; its
public `get` hook uses the installed Axios transport so cancellation/status/headers
are available. Xbox authentication uses its installed SDK's own ten-second
per-request timeout (clamped internally to at most 30 seconds).
Workers share a ten-minute attempt deadline through async context. They check
before outbound calls and writes, and reject late results. Nested work does not
reset the parent deadline. Achievement rows, completion status, local activity,
and game success state now share one MySQL transaction. Playtime/history
transaction recovery and durable activity publication remain pending work.

PSN has no in-flight cancellation or hard duration guarantee. Its library calls
may outlive the deadline; late results are rejected after returning and cannot
start another page or bypass write checkpoints. No library replacement, patch,
or fetch interception is used. Hung PSN calls retain their provider permits while
the process runs; two hung calls can require worker restart to restore progress.

`PlayerProviderBudgetModule` registers `player-provider-budget` only to reuse the
existing BullMQ Redis connection, without adding jobs to that queue. Admission
uses Redis server time and atomic Lua, with at most two admitted outbound calls
per provider across instances sharing the BullMQ prefix. Permits last 90 seconds
and renew every 30 seconds while a request is in flight. Process interruption
leaves leases that expire; ordinary completion/failure releases only its own
permit. Redis failure or lost renewal fails work rather than accepting its result.
The bound depends on healthy Redis/renewal; it is not proof about physical in-flight
requests after a lease expires during a network partition.

An observable 429 extends the shared provider cooldown by at least Retry-After;
when the provider omits a valid delay, the application uses a conservative
60-second cooldown. A later short delay cannot shorten an existing cooldown.
Admission waits observe attempt cancellation. Permits surround leaf calls, not
orchestrators that might request nested permits. Authentication is also admitted;
the Xbox SDK's sequential authentication exchange holds one permit for the flow.
These limits are conservative application choices, not measured request quotas.
Worker job rate limits alone do not enforce provider-wide quotas.

Existing five-attempt queue bounds remain. Unsupported achievement jobs finish
normally without transient retry attempts; complete empty libraries report zero
updated games rather than privacy errors. Failed requests remain bounded and can
recover on a later attempt. Importer workers currently recognize only the service's
exact no-unprocessed-entries 404 as empty; other 404s still fail. Task 12.1 will
move that legacy HTTP compatibility to the controller boundary.

Run the added failure/cache/deadline suites without provider credentials:

```sh
yarn test --runInBand --testPathPatterns='(sync/(provider-sync.error|player-sync-attempt|steam/|psn/|xbox/)|utils/cacheable|game-achievement.service|game-achievement-sync.processor|importer-watch.processor|playtime-watch.processor).*spec.ts$'
```

To test shared admission and actual queue retry counts, use disposable Redis:

```sh
docker run --rm -d --name player-import-test-redis -p 127.0.0.1:17379:6379 redis:8.10.3-alpine3.23
PLAYER_IMPORT_TEST_REDIS_PORT=17379 yarn test --runInBand --runTestsByPath src/sync/player-provider-budget.service.spec.ts src/game/game-achievement/sync/game-achievement-sync.processor.spec.ts
docker stop player-import-test-redis
```

Fixtures instantiate two budget services against the same isolated prefix and
verify cooldown sharing, provider independence, two-call concurrency, expired
permit recovery, cancelled waits, and nested orchestration. Queue fixtures verify
unsupported/empty work uses one attempt, a transient error recovers on attempt
two, and repeated failures stop at the configured bound. Cleanup touches only
random test prefixes/queues, never shared data. Redis checks are explicitly
skipped without `PLAYER_IMPORT_TEST_REDIS_PORT`.

This is a partial implementation of the OpenSpec change: achievement transaction
boundaries are in place, while durable activity publication recovery and
playtime-history changes are not yet complete. Daily full-refresh scheduling is
implemented; deployment remains gated on the remaining acceptance and rollout
work. These checks do not establish production quota headroom or rollout
readiness.

## Durable synchronization state and account identity

The `player_connection_sync` and `player_game_sync` tables, created by the
`InitialSchema` baseline, hold only synchronization state. They do not rewrite obtained achievements, playtime/history, collections,
or activities, and contain no publication or historical backfill operation.
The migration files are explicitly included despite the repository's general
migration ignore rule.

`player_connection_sync` has one row per connection, the current source account,
last combined success, indexed next eligibility, outcome/retry timing, owner token,
lease expiry, and attempt start. Its JSON `stages` retain independent playtime and
discovery outcome, successful time, and next eligibility. The due index is
`(nextEligibleAt, connectionId)`; EXPLAIN on 5,000 fixture connections selects it
for a 100-row ordered due query without reading libraries.

`player_game_sync` is keyed by `(connectionId, externalGameId)` and stores the
source account, successful checked time (including empty/unsupported outcomes),
activity fingerprint, daily eligibility, reconciliation due time, retry timing,
and ownership. It can represent a successful empty game without any obtained row.
Neither table infers success from the existence of obtained achievements.

Admission locks the current connection row, checks account identity, and admits
one token. A pending reservation lasts at most ten minutes, covering queue delay;
execution uses a 90-second lease renewed every 30 seconds, with no renewal beyond
the attempt's ten-minute window. A stale/expired token cannot commit over a newer
owner. Guarded local writes use the existing `typeorm-transactional` context and
retain the connection lock through commit, so account replacement/deletion cannot
race between a separate identity check and a write. Provider I/O stays outside
these guarded writes. Achievement obtained rows, completion status, local
activity, and successful game state also commit together; activity queue
publication follows that commit and still needs durable recovery if enqueueing
fails.

New queue payloads carry the admitted connection/account/owner identity and use
a distinct owner-based job ID. A rejected write compensates only an unstarted,
current reservation. If acknowledgement is uncertain, an existing job preserves
the owner; if Redis cannot resolve the uncertainty, lease expiry recovers it.
Retries of the same admission reuse its job ID. Legacy payloads without ownership
are terminal skips, never translated into work for a possibly replaced account.
Drain old queues before rollout if their work must finish under the old version.

Connection saves preserve cooldown for unchanged accounts, including settings-only
updates. Replacing an account invalidates only its synchronization markers; deleting
a connection cascades its state rows. Existing imported achievements/history remain.
The new-account state is immediately eligible. Existing accounts without state get
a deterministic UTC time slot within the next 24 hours, derived from connection
and source-account identity; persistence prevents restart from resetting it.
Bootstrap uses pages of 100 connection identities and performs no provider calls.
Initial game state stays unknown until a complete fetch succeeds, even when old
obtained rows exist. Game initial work follows account bootstrap; no migration
asserts historical synchronization completeness. Historical activity publication
needs the conservative cutoff from task 8.5 before broad reconciliation is enabled.

Run the isolated MySQL/Redis state checks with:

```sh
docker run --rm -d --name player-import-test-mysql -p 127.0.0.1:14306:3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.4.13
docker run --rm -d --name player-import-test-redis -p 127.0.0.1:17379:6379 redis:8.10.3-alpine3.23
docker exec player-import-test-mysql mysqladmin ping --silent
PLAYER_IMPORT_TEST_MYSQL_PORT=14306 PLAYER_IMPORT_TEST_REDIS_PORT=17379 yarn test --runInBand --runTestsByPath src/sync/player-data/player-sync-state.integration.spec.ts src/sync/player-data/player-sync-state.service.spec.ts src/sync/player-data/player-sync-policy.spec.ts
docker stop player-import-test-mysql player-import-test-redis
```

Wait for the disposable MySQL readiness check to succeed before running the suite.
Each suite creates and drops only its randomly named test database; queue checks
use random Redis prefixes. Fixtures cover migration up/down/up, indexed discovery,
competing owners, lease expiry, rollback, queue rejection/lost acknowledgement,
replacement/deletion, independent empty-game success, and bootstrap stability.

Before deployment, inspect pending migrations with
`yarn typeorm migration:show -d data-source.ts`, review the intended environment,
and run the existing `yarn migration:run` workflow before starting code that uses
these entities. Existing unrelated pending migrations require their own rollout
review. Daily scheduler activation remains gated on the remaining acceptance work.

Before rollback, stop scheduling/manual admissions and drain or safely reject all
owner-bearing jobs. Stop every binary that uses the new tables, including targeted
achievement reads/workers. Only then revert the two player-state migrations in
reverse order using `yarn typeorm migration:revert -d data-source.ts`, checking the
last migration name before each revert. Do not revert unrelated migrations. This
removes freshness/admission markers and requires a conservative bootstrap if the
new version is deployed again. Retain imported/history tables throughout; do not
roll back additive state while a running worker or pending job depends on it.

## Daily full refreshes and status

`PlayerDataQueueService` now owns the five-minute due-work tick and
`player-data-sync` queue (`player-data-refresh` jobs). It queries the indexed
state table in pages of 100 with a stable `(nextEligibleAt, connectionId)` cursor;
it never loads the full library population. Failed admissions do not stop later
rows, and are reported after the page walk. Bootstrap is metadata-only at module
initialization. The old four-times-daily playtime scan and restart-relative
importer interval have been removed.

Automatic due ticks are enabled by default. Set
`PLAYER_DATA_SYNC_ENABLED=false` to pause them through migrations, mixed-version
draining, and acceptance checks; remove that override or set it to `true` after
acceptance. Onboarding admission remains available under the same durable
policy.

All current users share a 24-hour successful full-refresh interval from one policy
constant; there are no tiers, payment checks, or premium frequency. Onboarding
uses the same admission/cooldown as the tick. New links and changed source accounts
are immediately eligible; settings-only updates and restarts preserve eligibility.
Normal automatic visibility can lag by up to the tick interval plus queue/provider
latency after eligibility. This is a freshness interval, not an exact-time SLA.

The full-refresh worker reuses the existing playtime/discovery processors under one
account-bound attempt. Complete library snapshots are memoized only within that
attempt; failures are removed from the memo and never become successful partial
snapshots. The two stages commit independent success markers. A queue retry runs
only still-due stages, so one failed persistence stage does not repeat a successful
stage. A successful full refresh aligns the next interval to 24 hours after the
combined completion. Failed attempts preserve earlier success timestamps; final
failures use a delayed retry of at least one hour and at least exposed Retry-After.

The new full-refresh queue explicitly keeps five attempts/five-second backoff and
the same one-hour/1,000 completed and seven-day/1,000 failed retention bounds.
Old playtime/importer queue processors now terminally skip legacy jobs; the full
worker directly reuses their processing functions. Drain or explicitly reject old
jobs before activation. Retained diagnostic jobs cannot block later daily runs,
because each admitted owner has a distinct job ID.

Full refreshes run on initial connection/account replacement and periodic due
ticks. The `connection-sync` WebSocket namespace has been removed, including
manual refresh, status requests, and playtime progress messages. Connection
creation still awaits queue admission and rejects failed Redis writes. Workers
retain progress and failure logs.

Real MySQL/Redis fixtures exercise all three providers with stage adapters across
two competing service instances, a restart, cooldown immediately before eligibility,
and a second cycle at exactly 24 hours. They assert one admitted job and one set of
stage writes per cycle, retained history with distinct job IDs, account replacement,
and independent retry of a failed stage. The provider-boundary tests use fixtures,
not live accounts. These checks are not measurements of provider quota headroom.
Future premium cadence remains blocked on workload measurements and cache TTL
review, including the retained provider caches.

## Achievement selection and reconciliation

Achievement work is tracked per provider connection and external game. A game is
selected when it has no successful check, a supported activity/progress
fingerprint changes, a previous failed/incomplete attempt reaches `retryAt`, or
its seven-day reconciliation time is due. Successful game checks have a
24-hour minimum interval; reconciliation is scheduled seven days after the last
successful check. A targeted request without a fingerprint uses the `manual`
reason after the same eligibility and owner checks. Active owner leases
deduplicate the same connection/game job.

Selection fingerprints use the signals exposed by each provider: Steam
cumulative and recent minutes (the recent list takes precedence and includes
Family Sharing games), PSN mapping identity plus trophy-set version/update and
progress, and Xbox title/achievement progress. Steam selection does not require
`lastPlayedTimestamp`, and Xbox achievement selection does not require
MinutesPlayed statistics. Provider changes without an exposed signal are found
by the seven-day reconciliation.

Examples:

- **Initial:** no successful per-game state exists, so the first eligible
  library scan queues an `initial` check even when playtime is missing.
- **Active change:** a due game has a different fingerprint, so it queues an
  `activity` check after its 24-hour minimum interval.
- **Failed retry:** a prior failed/incomplete result remains retryable; once
  `retryAt` is due, it queues a `retry` without changing the last success time.
- **Inactive reconciliation:** the fingerprint is unchanged, but seven days
  have passed since success, so it queues a `reconciliation` check. This can
  discover delayed achievements without new playtime.
- **Manual:** a targeted request with no provider fingerprint queues a `manual`
  check only when the per-game cooldown and owner lease allow it.

`unknown` means no complete check has succeeded yet. `empty` means a complete
provider response was checked and contained no obtained achievements. Empty and
unsupported outcomes are persisted as successful checks, so neither is retried
as an initial import every day; both remain eligible for later reconciliation.

## Achievement transaction and idempotency

The worker fetches the obtained-achievement snapshot and sync catalogue before
opening a database transaction. Those snapshots are reused for obtained-row
persistence, completion status, and activity calculation. The sync catalogue
path omits Steam's presentation-only rarity request and platform presentation
lookup; display reads retain those fields.

For each user and external game, the worker acquires the MySQL session lock
`ga:<userId>:<externalGameId>` with a 30-second wait, then holds it through the
transaction commit. The transaction writes newly obtained rows, completion
status when a catalogue is available, an activity when there are new rows and a
catalogue, and the successful game-sync state. A failure rolls back those local
writes and the queue job can retry; provider reads are outside the transaction
and are fetched again on retry. The lock is released after commit or rollback.

Obtained-achievement identity is
`(profileUserId, externalGameId, externalAchievementId)`, enforced by the
existing unique constraint. The per-user/game lock serializes concurrent
reconciliations before they compare existing rows, so overlapping imports only
persist the new set once and create one activity. Replays with no new rows do
not create another activity.

Completion status is recalculated only from a complete catalogue and obtained
snapshot. An unchanged completed game keeps its existing `completedAt`, even if
the catalogue grows and the game remains complete. A transition into completed
sets `completedAt` to the current time; a complete catalogue that shows a new
unearned achievement makes the game incomplete and clears it. Failed or
incomplete provider reads do not update completion status. An empty catalogue
skips completion and activity writes; newly obtained rows and successful game
state can still commit.

Activity publication is attempted only after the transaction commits. New local
activity rows include `pendingDelivery = true` in the same transaction, so a
crash in the commit-to-queue gap leaves a durable marker. The worker awaits the
activity queue's acknowledgement using the activity row ID as its stable job
identity, then clears the marker. A rejected enqueue leaves the marker set and
does not roll back committed achievements. A five-minute recovery tick scans at
most 100 pending rows in ID order and retries them without provider reads. Do not
treat the queue call as transactionally atomic with the database.

The legacy cutoff is the migration boundary: the new non-null marker defaults to
false for every existing activity, while new rows are explicitly created as
pending. Recovery selects only `pendingDelivery = true`; it never infers pending
delivery from activity age or republishes history in bulk. The MySQL fixture
verifies an old row stays false while a new marked row is delivered.

The disposable-MySQL integration fixture documents the expected outcomes:

- Empty obtained and catalogue snapshots write only successful game state.
- Existing obtained rows create no second activity.
- New rows with no catalogue persist without completion or activity.
- A changed complete catalogue persists only the newly obtained row and reports
  that delta in one activity.
- Multiple PSN sets produce one combined activity, including platinum status.
- Injected failures at obtained rows, completion status, activity, or game state
  roll back the transaction; a retry after rollback can then succeed.
- The new activity row's pending-delivery marker commits with that row.
- A queue rejection after commit leaves both the achievement and pending marker
  in place for later delivery.
- Overlapping attempts serialize and create one achievement set and activity.

Run these fixtures with disposable MySQL:

```sh
docker run --rm -d --name player-import-test-mysql -p 127.0.0.1:14306:3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.4.13
docker exec player-import-test-mysql mysqladmin ping --silent
PLAYER_IMPORT_TEST_MYSQL_PORT=14306 yarn test --runInBand --runTestsByPath src/game/game-achievement/sync/game-achievement-sync.transaction.integration.spec.ts
docker stop player-import-test-mysql
```

The suite skips without `PLAYER_IMPORT_TEST_MYSQL_PORT`; it creates and drops
its own randomly named database.

## Activity delivery diagnosis and replay

Inspect pending local achievement activities by source row; the recovery tick
handles at most 100 oldest rows every five minutes:

```sql
SELECT id, profileUserId, externalGameId, totalObtained, createdAt
FROM obtained_game_achievement_activity
WHERE pendingDelivery = 1
ORDER BY id
LIMIT 100;
```

The BullMQ activity job ID is
`activity-OBTAINED_GAME_ACHIEVEMENT-<activityId>`. Check that job's state and
failure in the activities queue, then check whether the source already has a
feed row:

```sql
SELECT id, createdAt
FROM activity
WHERE type = 'OBTAINED_GAME_ACHIEVEMENT'
  AND obtainedGameAchievementActivityId = <activityId>
  AND profileUserId = '<profileUserId>';
```

For a deliberate one-row replay, re-arm only the pending marker using the exact
activity and profile IDs, then allow the next recovery tick to enqueue it:

```sql
UPDATE obtained_game_achievement_activity
SET pendingDelivery = 1
WHERE id = <activityId>
  AND profileUserId = '<profileUserId>'
  AND pendingDelivery = 0;
```

Confirm that one row was changed; if it is already pending, let the recovery
tick retry it. Do not rerun provider import or insert
obtained achievements for delivery repair; the existing activity row is the
source. A repeated queue delivery resolves to the same feed row, and the source
marker clears only after the queue acknowledges the deterministic job ID. A
still-pending marker means enqueue has not been confirmed; queue acceptance
alone does not prove the feed worker completed successfully.

## Playtime observation estimates

History `createdAt` records when a cumulative total was observed; provider first/
last-played dates describe provider activity and are not observation boundaries.
For a period `(start, end]`, each sample is compared with its predecessor in
`createdAt, id` order. Samples at start establish the baseline; samples at end
are included. A positive increment belongs to its ending observation. For
example, 100 seconds before start and 160 inside the period contribute 60.
The first-ever sample establishes an unknown baseline and contributes zero.
A decrease establishes a corrected baseline: 100→80→90 contributes 10, while
100→160→120→150 contributes 90. These are endpoint estimates, not exact play dates
or reconstructed sessions. Equal timestamps are ordered by history ID.

PSN/Xbox recent time derives from the rolling 14-day observation window and
expires on refresh even when lifetime totals do not change. Steam retains its
provider-supplied recent total, including that provider's window semantics.
For mapped Xbox games still present in a complete library, missing or valueless
MinutesPlayed statistics reuse known cumulative values, dates, and counts while
recalculating recent time. No zero lifetime sample or new history is invented.
PSN supplies authoritative play counts. Steam/Xbox retain historical counts;
polling changes do not create new sessions or reset legacy counts.

No migration rewrites historical observations. Legacy timestamps can reflect
old insertion/polling behavior rather than accurate observation times; their
period attribution has that precision limit, and missing earlier baselines
cannot be reconstructed. Manual submissions retain session ownership and now
reject invalid sources, nonpositive/noninteger IDs, seconds outside the signed
INT range (0–2,147,483,647), and invalid supplied dates with HTTP 400. Played dates
may be null or omitted. Client compatibility for these stricter inputs must be
checked before rollout.

## Measured local import work

The disposable-MySQL playtime fixture imports 1,001 PSN games with null played
dates, then changes five cumulative totals by 10 seconds. Neither run uses a
history-result cache. Both make three current-state reads (chunks of 500/500/1)
and one period aggregation. Cold import writes 1,001 history/current pairs and
logs 4,010 SQL statements. Warm import writes five pairs and logs 31 statements;
the other 996 rows preserve their totals/counts. Statement totals include
TypeORM's generated-value reloads, update comparisons, and transaction commands;
they are not merely application-level repository call counts. Both runs use zero
provider leaf calls and zero provider-cache hits because this is a persistence
fixture, not a provider benchmark.

A separate deterministic admission fixture uses the actual selection policy for
1,001 games without timestamps. It admits 1,001 initial jobs and five jobs after
a 24-hour advance and five changed fingerprints. It still performs 1,001 per-game
selection/admission checks on each run. This test uses an in-memory state adapter;
it does not measure Redis, MySQL admission statements, or provider leaf calls.
Queue jobs, selection checks, database statements, and provider requests must be
reported separately. Xbox's absent-statistics selection has its own fixture.

Review regressions also compare the previously repeated work directly. A cold
Steam obtained/catalogue pair now shares one schema call per attempt instead of
two; a failed shared fetch can retry. The 1,001-game discovery fixture now reads
each complete processed/ignored list once instead of 12 times and visits the
deduplicated candidates in ten pages of 100 and one page of one. Per-item live
processed/ignored and ownership checks remain in place. These are fixture call
counts, not an old-versus-new production throughput benchmark.

EXPLAIN of the actual period query initially showed full scans for both current
window and predecessor observations. With 1,006 target observations, 5,000 older
target observations and 5,000 unrelated observations, the additive observation
migration selects `IDX_playtime_observation_window` with range access (1,006
estimated rows) and `IDX_playtime_observation_previous` with ref access (one
estimated predecessor row). The indexes cover the actual window and predecessor
predicates; up/down/up checks preserve every history row. The actual due-state
query (including retry/lease predicates) retains `IDX_player_connection_due` on
the 5,000-connection fixture. Optimizer row estimates vary with data distribution.

For a comparable deployment baseline, record fixture size, changed fraction,
provider/cache state, selected jobs, leaf calls, database statements, queue age,
and outcomes before and after the change. Keep snapshots and correctness equal;
do not compare incomplete provider results with complete imports or count cache
hits as eliminated provider work. These fixtures assert no production savings
percentage or provider quota headroom. Premium frequency remains unimplemented
and requires measured fleet/provider load and a separate TTL review.

## Achievement reads and owner status

V1/v2 obtained routes and journal playlogs return persisted obtained fields.
Only the signed-in owner can request a background obtained refresh through a
read; another user's public achievements remain visible without enqueue authority.
The shared per-game admission applies the same 24-hour cooldown and pending lease
across all owner routes. Queue rejection does not discard readable stale rows.
Available catalogue/rarity display paths retain their existing provider caches;
they are separate from account-specific obtained refreshes.

The removed `connection-sync` namespace no longer exposes `achievement-status`.
Per-game cooldowns, leases, and outcomes remain part of internal admission and
worker persistence. Games must belong to the requested provider in admission and
again before worker persistence.

Frontend source is outside this repository. Before rollout, its maintainers must
remove connection websocket calls and progress subscriptions, and verify
initial-empty versus unknown/pending presentation, stale-read timestamps,
unchanged public-read payloads, and the stricter manual-playtime validation.
This is a rollout prerequisite, not a completed
frontend compatibility review.

## Auto-import and notification recovery

Background discovery treats a complete empty library as success. Only the HTTP
controller preserves the no-unprocessed-games 404; an empty search over a nonempty
library still succeeds. Workers process at most 100 discovered internal-game IDs
per page. They build the deduplicated candidate snapshot once, order it once by
game ID, and slice that stable list without reloading complete processed/ignored
lists for every page. Each import still rechecks current choices before writing.
HTTP pagination retains provider order. Provider snapshots remain complete;
this page size bounds local processing, not the provider's library size.

Each page commits collection writes, processed transitions, notification source
records, and notified/retry markers in one transaction. Collection creation takes
a library-row lock shared with manual creation because legacy collection entries
have no user/game uniqueness constraint. A retry preserves an existing entry's
favorites, status, platforms, dates, and collection membership and finishes its
missing processed transition. Destination ownership is rechecked at execution;
a deleted destination falls back to an entry with no destination collection,
matching a connection with no configured destination. A foreign destination fails
without writing into it. Ignored/processed entries are rechecked before import.

New failed items receive `autoImportRetryable = 1` on their notified marker.
A later retry imports only remaining eligible items and does not publish another
discovery notification for the same external game. Imported/skipped/failed counts
on each notification describe that page's committed outcomes. Failed imports
remain failures even if their discovery was notified. Existing legacy markers
start with retryable false, so enabling this code does not bulk-replay them.

New discovery notification intents append directly to `notification_outbox`
inside `commitPage` in the same database transaction as the page commit, with
event type `import.discovery-completed`. Delivery is decoupled from the importer
run: `NotificationsRelayService` claims pending outbox rows and enqueues them to
the shared `notifications-queue`. Delivery retries, backoff, and diagnostics are
governed by the central outbox lifecycle rather than legacy cron polling or
fire-and-forget queues. Downstream materialization aggregates outcomes into the user's
inbox idempotently by discovery result identity (`importer-result-<resultId>`). Exact discovered-game totals and three
bounded internal-game samples come from committed results; counts are not inferred
from automatic-import totals, which may all be zero. The old importer delivery cron,
queue publisher and `pendingDelivery` field are removed. See `docs/notifications.md`
for the inventory/convert/verify commands and coordinated backup requirement.

Inspect/recover an importer notification through the shared outbox:

```sql
SELECT id, eventType, eventVersion, occurredAt, recipientUserId, state, attempts, nextAttemptAt, lastError
FROM notification_outbox
WHERE eventType = 'import.discovery-completed'
  AND recipientUserId = '<userId>'
ORDER BY occurredAt DESC LIMIT 20;

-- Targeted rearm if delivery attempts were exhausted:
UPDATE notification_outbox
SET state = 'pending', attempts = 0, ownerToken = NULL, ownerExpiresAt = NULL, nextAttemptAt = NOW()
WHERE id = '<outboxId>' AND state = 'failed';
```

Queue acceptance is not proof of completed consumption. Outbox state remains the
single retry authority. Do not reset processed/ignored rows or rerun imports to
repair publication.

For deliberate legacy import recovery, review one user/external-game identity,
ensure it is absent from both processed and ignored tables, and rearm only that
notified row's `autoImportRetryable` flag. Let the next eligible daily attempt
perform the import; never update all legacy markers or delete history. Confirm
the destination and current account before this opt-in repair. The MySQL recovery
suite runs on the existing `igdb_sync_test` MySQL/Redis fixture through
`yarn test:notifications`, without dotenv or application database settings. It
verifies outbox and page rollback, mixed-outcome retry, preserved manual/ignored
choices, ownership/deletion fallback, idempotent projection/read versions, and
real queued full/manual/read races across a second daily cycle. Run migrations
for the application with `yarn migration:run`; never point these fixture suites
at the application database.

## Operational summaries and health checks

`player-sync-run` structured logs contain only bounded source/outcome/kind labels,
duration, queue age, retry count, games seen/selected/skipped/changed, stage
success/failure counts, committed imported/skipped/failed outcomes, and provider
leaf-call counts. `gamesSeen` is the largest library/discovery count seen across
shared stages; it is not doubled for snapshot reuse. `gamesChanged` counts
committed changed cumulative games or committed achievement changes, according to
kind. Provider calls count executions at the cancellable/uncancellable client
boundary after shared-budget admission; calls hidden inside an opaque PSN SDK
operation are not transport-level measurements. A failure counts the attempted
leaf request, and cache hits do not increment this counter. Partial stage success
is logged as `partial`; prior successful timestamps remain persisted.

No user/game/account IDs, owner tokens, provider payloads, or credentials are
summary dimensions. Necessary diagnostic IDs remain in existing authorized
service logs/status. Summary tests cover successful, empty, partial, throttled,
and failed runs and check that raw causes and authentication material are absent.

Inspect bounded operational categories with these database checks:

```sql
SELECT c.type, s.outcome, COUNT(*) AS connections,
       MIN(s.lastSucceededAt) AS oldestSuccess, MIN(s.nextEligibleAt) AS oldestDue
FROM player_connection_sync s JOIN user_connection c ON c.id = s.connectionId
GROUP BY c.type, s.outcome;
SELECT c.type, COUNT(*) AS staleSuccessfulConnections
FROM player_connection_sync s JOIN user_connection c ON c.id = s.connectionId
WHERE s.lastSucceededAt < UTC_TIMESTAMP() - INTERVAL 25 HOUR
GROUP BY c.type;
SELECT c.type, COUNT(*) AS overdueGames, MIN(g.reconcileAt) AS oldestDue
FROM player_game_sync g JOIN user_connection c ON c.id = g.connectionId
WHERE g.reconcileAt < UTC_TIMESTAMP() AND g.sourceUserId = c.sourceUserId
GROUP BY c.type;
SELECT outcome, COUNT(*) AS games FROM player_game_sync
WHERE outcome IN ('throttled', 'failed', 'incomplete', 'unavailable')
GROUP BY outcome;
SELECT COUNT(*) AS pendingActivities FROM obtained_game_achievement_activity WHERE pendingDelivery = 1;
SELECT state, COUNT(*) AS notifications FROM notification_outbox
WHERE eventType = 'import.discovery-completed' GROUP BY state;
```

Inspect BullMQ counts without payloads or credentials, using the deployment's
existing prefix and Redis configuration:

```sh
node -r dotenv/config -e '
const {Queue} = require("bullmq");
(async () => {
  const url = new URL(process.env.BULLMQ_REDIS_URL);
  for (const name of ["player-data-sync", "game-achievement-sync", "activities", "notifications-queue"]) {
    const queue = new Queue(name, {connection: {host: url.hostname, port: Number(url.port || 6379)}});
    console.log(name, await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"));
    await queue.close();
  }
})().catch(() => { console.error("Queue inspection failed"); process.exitCode = 1; });'
```

Use the actual activities/notification queue names from their constants if a
deployment changes them. Inspect oldest queue timestamps and `player-sync-run`
queueAgeMs alongside counts. Alert on increasing backlog, successes older than
cadence plus observed queue latency, repeated throttled outcomes, pending delivery
that survives multiple ticks, or increasing reconciliation lag. An empty success
with a fresh timestamp differs from a provider failure with an unchanged prior
success. These checks require no provider secrets or raw response bodies.

## Staged deployment, mixed versions, and rollback

1. Keep `PLAYER_DATA_SYNC_ENABLED=false` in deployment configuration. Build with
   `yarn build` and run the queue option/lifecycle suites above. Verify new run IDs
   execute despite retained completion and all queue writes are awaited. Ship the
   queue fixes before activating daily scheduling.
2. Stop affected workers and manual refresh ingress for the migration window.
   Apply `yarn migration:run` using the deployment's database configuration.
   `SHOW TABLES LIKE 'player_%_sync'` and `SHOW INDEX FROM user_playtime_history`
   must show the additive sync tables and observation indexes. Check that the
   importer entry retry state remains intact. Domain import history is retained.
3. Start only the new binary with cadence still disabled. Bootstrap runs in
   bounded pages and persists a deterministic daily spread. Inspect
   `SELECT MIN(nextEligibleAt), MAX(nextEligibleAt), COUNT(*) FROM player_connection_sync`
   and use the due/outcome queries above; restarting must preserve these values.
   Existing obtained rows do not prove a complete game check.
4. Drain active legacy work while new admission is paused, or route old jobs only
   to the new processors that reject/skip them. Inspect queue counts before and
   after. The new full processor rejects ownerless old payloads without provider
   calls; legacy playtime/importer workers terminally skip their old queues, and
   achievement jobs without an owner terminally skip. The real-Redis fixture
   verifies an old full payload fails once even with five configured attempts.
   Do not let old binaries consume new owner-bound jobs: they ignore new leases.
5. If desired, perform only the terminal legacy importer cleanup described above.
   Record candidate IDs and verify preserved waiting/active jobs. Never flush
   Redis, clean unrelated queues, or delete history. New owner IDs do not depend
   on this optional cleanup.
6. Deploy the new HTTP/journal consumers together with shared admission and the
   worker persistence paths. Verify the v1/v2/journal/HTTP/WS contract suites and
   obtain the frontend compatibility review described above. Confirm account
   replacement invalidates old jobs and status omits owner/account secrets.
7. After acceptance, enable `PLAYER_DATA_SYNC_ENABLED=true` in deployment
   configuration and restart/reload by the deployment's normal procedure. Observe
   one onboarding run, a cooldown rejection, a second daily cycle, bounded backlog,
   and a controlled-clock seven-day reconciliation/14-day expiry test. Daily
   activation is the final deployment step; paid cadence remains disabled.
8. For binary rollback, first disable admission/refresh ingress and stop **all**
   old and new affected workers, then inspect active/waiting jobs and drain or
   isolate incompatible payloads. Preserve local rows and pending delivery flags.
   Only restart a compatible worker/consumer set; an old worker can overwrite
   replaced-account state because it does not enforce new owners. A rollback is
   not safe merely because daily scheduling is off. Leave additive migrations in
   place while any running version, pending job, or undelivered record needs them.
   Reverse migrations only in a separately coordinated maintenance window after
   those dependencies are gone; never remove history or globally clear queues.

Connection account replacement is checked again before writes. Mixed-version
recovery must pause scheduling and old binaries rather than relying on a new
worker to protect a concurrently running old worker. Provider quotas, fleet size,
and higher-frequency TTL safety remain unmeasured deployment inputs. The cold/
warm fixture methodology above is the baseline; no production percentage or
premium capacity is inferred from it.

## Acceptance verification and cleanup

Use only disposable databases/Redis for these fixtures. They create random database
names and queue prefixes and remove those resources on completion; they never
truncate the application database or flush Redis.

```sh
docker run --rm -d --name player-import-test-mysql -p 127.0.0.1:14306:3306 -e MYSQL_ALLOW_EMPTY_PASSWORD=yes mysql:8.4.13
docker exec player-import-test-mysql mysqladmin ping --silent
docker run --rm -d --name player-import-test-redis -p 127.0.0.1:14379:6379 redis:8.10.3-alpine3.23
PLAYER_IMPORT_TEST_MYSQL_PORT=14306 PLAYER_IMPORT_TEST_REDIS_PORT=14379 yarn test --runInBand --testPathPatterns='(playtime/|importer/|connection/|sync/(player|provider|steam/|psn/|xbox/)|game/(game-achievement/|external-game/)|activities/activities-(queue|repository)/|journal/|notifications/|collections/collections-entries/).*spec.ts$'
yarn build
openspec validate optimize-player-data-imports --strict
docker stop player-import-test-redis player-import-test-mysql
```

The three-provider state fixtures now persist actual cumulative playtime/history
on both daily cycles, including PSN counts and derived recent deltas. The combined
Steam acceptance fixture races scheduler/manual full admission with an owner
obtained read, then runs real full, achievement, activity, and notification queues
against MySQL. It checks one full execution, one obtained fetch per game, shared
library reuse, and one set of local/feed/notification records. After restart and a
24-hour clock advance, one changed game refreshes while unchanged records remain
stable; cumulative time advances without duplicate achievements/feed/notifications.
Separate controlled-clock MySQL fixtures expire PSN/Xbox recent increments after
14 days while retaining Steam's supplied recent value. Seven-day inactive/empty
reconciliation and delayed achievements use the shared policy/worker fixtures.

Fault coverage includes incomplete provider pages, rejected/uncertain admissions,
history/current writes, achievement transaction writes, post-commit activity
publication, notification-source commit failure, and notification enqueue failure.
Expired owners and replaced accounts are rejected before new writes. The large-
library cold/warm fixtures verify equivalent results and selected work with no
history-result cache. Provider adapters are fixture responses; no live Steam,
PSN, or Xbox account/quota/cancellation checks were performed. Frontend review
and deployment observation remain prerequisites, with daily activation disabled
in the example configuration.

Swagger uses the existing `yarn build` and `SwaggerModule.createDocument` flow from
`src/main.ts`. For verification it was generated by constructing the app against
an isolated empty MySQL database/Redis, creating the document **before** app
initialization/listen, then closing the app. This resolves the full module graph
without starting workers, bootstrap, or schedulers. Review the manual DTO's
integer ranges/optional dates and notification outcome fields; private delivery
markers/identities are excluded from public response schemas.

Verification after the four earlier review fixes: `yarn build` passed; the scoped player
import/controller/journal/collection/activity/notification/provider run passed
333 tests in 52 suites with both disposable services enabled and no skipped
integration checks. Strict OpenSpec validation and whitespace checks passed.
The Xbox 5,000-title service-cap follow-up updated existing fixtures but its
tests were not rerun. The earlier implementation checkpoint recorded 116
passing search tests and regenerated Swagger; those checks were not repeated for these internal
fixes, which change no HTTP schemas or search implementation.
No change was archived and no production cadence was enabled. Live-provider,
frontend, and production-load checks remain rollout prerequisites.
