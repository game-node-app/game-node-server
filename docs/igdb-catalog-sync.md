# IGDB catalog synchronization

## Local verification

Use Node.js, Yarn Classic (or `corepack yarn`), Docker Engine and Docker Compose.
The disposable harness runs only MySQL 8 and Redis 7, without application `.env`,
external authentication or live IGDB credentials.

```sh
yarn test:igdb:services:up
yarn test:igdb:unit
yarn test:igdb:integration
yarn test:igdb:services:down
```

Startup waits for healthy services. Cleanup removes only the `igdb-sync-test`
project and its disposable volumes. Run cleanup when verification is finished.
If Docker is missing or unavailable, install/start Docker Engine and its Compose
plugin, then retry `docker info` and `docker compose version` before starting.

Host bindings default to `127.0.0.1:13306` for MySQL and `127.0.0.1:16379` for
Redis. Override `IGDB_TEST_MYSQL_PORT` / `IGDB_TEST_REDIS_PORT` consistently for
Compose and tests if those ports are occupied. MySQL uses database
`igdb_sync_test`, user `igdb_test`, and test-only password `igdb-test-password`.
Queue prefixes must begin with `igdb-test-`. Tests reject non-loopback hosts and
other database names. Do not point this harness at an application database.

Redis uses AOF persistence and `noeviction`. Test data lives in project-specific
volumes; neither existing deployment Compose file is used by these commands.

The unit script uses the existing `src` Jest root and selects IGDB, game-create
and statistics suites. The integration configuration uses the repository root
and selects only `test/igdb/**/*.integration-spec.ts`, including the environment
guard smoke suite outside `src`. Neither command selects unrelated e2e suites.

## Configuration

The in-process catalog importer is always active. There is no
`IGDB_CATALOG_ENABLED` toggle or external payload ingestion mode. On application
startup, the scheduler starts an eligible run or recovers an unfinished run; it
checks again every 60 seconds.

All numeric settings require full-string integers; fractions, whitespace,
trailing text and out-of-range values fail validation.

- `IGDB_CATALOG_INTERVAL_DAYS`: default 7; accepts only 7 or 14.
- `IGDB_CATALOG_BATCH_SIZE`: default 25; range 1–500.
- `IGDB_CATALOG_GAME_CONCURRENCY`: default 1; range 1–2.
- `IGDB_CATALOG_RELATION_CONCURRENCY`: default 2; range 1–2 across the run.
- `IGDB_CATALOG_HTTP_TIMEOUT_MS`: default 30000; range 1000–60000.
- `IGDB_CATALOG_MAX_RESPONSE_BYTES`: default 16777216; range 1048576–67108864.
- `IGDB_CATALOG_MAX_ATTEMPTS`: default 3; range 1–5 per failing stage.

The ownership lease is fixed at 120 seconds, renewed every 20 seconds;
scheduler reconciliation occurs every 60 seconds. Retry backoff starts at 1000
ms, doubles, adds 0–250 ms jitter, and caps at 30000 ms. `Retry-After` waits also
cap at 30000 ms. Terminal orchestration retention is 10 completed and 10 failed
jobs. These constants are not environment overrides.

## Durable state transitions

The single `igdb_catalog_state` row has key 1. Before a first run it is `idle`,
with null run ID, upper boundary, timestamps and owner. Claiming eligible idle or
completed state creates a `running` run from cursor zero. The initial run forces
relationship reconciliation; this flag stays with the run during recovery.

Claiming an expired `running` run preserves its run ID, upper boundary and
committed cursor, and advances the ownership generation. Renewal extends the
current owner's lease. Every game transaction locks and validates that owner;
checkpointing advances committed cursor and counts only after a whole page.

A game IGDB returns without a valid identity or name is skipped with a
`catalog.game.skipped` warning; it never pauses the scan. Any other persistent
failure moves `running` to `paused` without advancing the cursor and logs the
error. After a one-hour cooldown the scheduler resumes that same run
automatically: it returns to `running`, clears its attempt budget, and preserves
its boundary and progress. No operator action is required. Successful empty-page completion changes `running` to `completed`,
clears ownership and sets the next eligible time to completion plus 7 or 14
days in UTC. A later eligible claim starts a new scan. Ownership generations
fence all mutations by old workers. Disabling or stopping a worker preserves
durable progress for later recovery.

## Forward game references

The internal importer creates minimal referenced-game rows before writing game
links, using the current game's transaction. These insert-if-missing rows contain
source ID, name and slug, with a null checksum. Existing game metadata and
statistics counters are preserved. Statistics initialization and junction writes
share the transaction; failure rolls them all back. Later full ingestion hydrates
the reference row normally. These inserts do not advance cursor/counts or fetch
ahead, including references above the current scan boundary.

This approved design resolves the audit's foreign-key failure on an empty
database. Implementation and regression coverage belong to tasks 4.2–4.5.

## Initial implementation verification handoff

The results below were recorded before the follow-up removed the opt-in flag and
legacy ingestion path. They document the original bounded importer; they do not
verify the current internal-only revision. Re-run the checks after that follow-up
before relying on them for the current code.

The original 48 tasks were complete. The internal fetcher, transactional importer,
compact queue worker, scheduler and operator commands were implemented. Local unit/integration checks
covered legacy authentication/mode behavior, migration rollback, durable progress,
leases/fencing, transaction rollback, forward-reference hydration, concurrent
statistics insertion, source validation, token refresh, retries and backpressure.

Node v24.22.1 is used for local verification. The resource check runs seed 42 at
batch size 25, game concurrency 1 and relationship concurrency 2. Reports live at
`.tmp/igdb-sync/resources-100.json` and `.tmp/igdb-sync/resources-1000.json`.
Verified commands/results:

- `corepack yarn test:igdb:unit`: 14 suites, 88 tests passed.
- `corepack yarn test:igdb:integration`: 9 suites, 30 tests passed, including
  the five two-process recovery cases.
- `corepack yarn test:igdb:resources`: both fresh child runs passed. The
  100-page/2,500-game fixture completed in 127213 ms; the
  1,000-page/25,000-game fixture completed in 1200468 ms. Both observed one live
  page, one active game, two relationship operations and zero statistics jobs.
  Each 25-run retention exercise ended at 10 completed/10 failed/zero pending.
- Both JSON reports passed field/redaction checks and are ignored by Git.
  Source cursors were 7542 and 75042. Minimal forward references produced 2501
  and 25001 game/statistics rows, as expected, without increasing committed counts.
- `corepack yarn build`, direct ESLint without `--fix`, `git diff --check`, and
  `openspec validate migrate-igdb-sync-with-bounded-batches --strict`: passed.

Elapsed times and sampled memory are local diagnostics, not server-capacity
acceptance thresholds. `corepack yarn test:igdb:services:down` completed successfully, removing both
disposable containers, their network and volumes. No test worker processes remain;
the ignored JSON reports are retained.

The recovery suite uses two local child workers with faults after game commit
and before checkpoint, owner kill/lease takeover, old-owner resumption, checkpoint
failure, invalid data, Redis disconnection and explicit correction/resume. It
checks unique links, preserved counters and a shared writer-admission maximum.
All child processes are awaited/terminated and their prefixed fixtures removed.

Existing root Compose edits are preserved. No tracked prior test suites exist in
the changed IGDB/game-create/statistics areas; legacy ingestion and normalization
regressions are included in the added unit suites. ESLint runs directly on changed
TypeScript files with `ESLINT_USE_FLAT_CONFIG=false`, without `--fix`, to use the
existing repository configuration. ESLint's configuration deprecation notice is
an existing tooling limitation.

## Source projection appendix

The projection is audited against the sibling Python producer's `IGDB_FIELDS`
and the [IGDB field definitions](https://api-docs.igdb.com/). Wildcards expand
only to fields consumed by existing entity columns or conversion:

- `id/name/slug/checksum/summary/storyline/url` map directly to `Game`.
  `aggregated_rating`, `aggregated_rating_count`, `first_release_date` and
  `updated_at` map to their camelCase columns; dates convert from epoch seconds.
  `category/status` are explicit deprecated fields; `game_type/game_status` are
  their conversion fallbacks.
- `cover.*`, `screenshots.*`, `artworks.*` map to `GameImage` subclasses: identity,
  checksum, alpha channel, animation, dimensions, image ID and URL.
- `game_modes.*`, `themes.*`, `player_perspectives.*`, `genres.*`, `franchises.*`,
  `keywords.*`, `game_engines.*` map to `GameResource`: identity, name, slug,
  checksum, URL and timestamps. Engine platform/company expansions follow below.
- `platforms.*` and `game_engines.platforms.*` retain id, name, abbreviation,
  alternative name, category, generation, checksum and timestamps. The existing
  converter emits camelCase keys; the platform entity retains its historical
  `alternative_name` column name.
- `expanded_games.id/name/slug`, `dlcs.id/name/slug/checksum`,
  `expansions.id/name/slug/checksum`, `similar_games.id/name/slug/checksum` map to
  game links. Expanded-game checksums are also requested. Referenced names/slugs
  permit minimal rows without fetching ahead.
- `involved_companies.*` retains identity, checksum, role flags and timestamps.
  `involved_companies.company.*` and `game_engines.companies.*` map to
  `GameCompany`: identity, name, slug, checksum, country, description, URL,
  parent/changed-company IDs, dates/date categories and timestamps. Both
  `.company.logo.*` and `.companies.logo.*` map to `GameCompanyLogo` image fields.
- `alternative_names.*` retains id, name, comment and checksum.
- `external_games.*` retains id, UID, category, media, checksum, name, URL, year
  and timestamps; deprecated category/media are explicit, alongside their
  `external_game_source/game_release_format` fallbacks.
- `game_localizations.*` retains id, name, checksum and timestamps. The converter
  preserves both `gameLocalizations` and its legacy `localizations` alias.
  Region/cover are not columns in the current localization entity.
- Unused original entries are `version_parent`, `version_title`, `parent_game`,
  `collections.*`, `language_supports.*`, `age_ratings.*`. No current create
  handler persists them. Other wildcard fields outside these mapped destinations
  are omitted; no supported persistence destination is removed.

## Relationship reconciliation cadence

The initial internal full scan forces relationship reconciliation for every
consumed game, including matching checksums and page replay after a restart.
This flag is persisted with the run. Later scans preserve normal checksum skips
and the existing epoch-week buckets (`IGDB_SYNC_RECONCILE_EVERY_RUNS`, default 4).
Only the bucket matching a game's ID reconciles unchanged relationships in that
week. This policy is separate from the 7/14-day cooldown between completed scans;
a full scan every week does not force every unchanged relationship every week.
Base checksums and required relationships commit together, so a failed game
cannot leave behind a successful checksum that hides its failed writes.

## Activation, commands and recovery

Apply the state migration before starting the application. Export application
database settings for the operator command; it intentionally does not load
`.env` or bootstrap the application, workers, authentication or scheduler.
`status` opens only MySQL. `resume` also requires queue Redis.

```sh
yarn igdb:catalog status
yarn igdb:catalog resume
# Disposable local fixtures use test-only connection defaults:
yarn igdb:catalog status --local
yarn igdb:catalog resume --local
```

Paused runs resume automatically after a one-hour cooldown; `resume` only skips
that wait. Resume preserves run
ID, cursor and upper boundary, clears attempt budgets and reconciles the same
queue job. A failed/retained job is retried, not replaced by a new job each tick.
Missing jobs are recreated with the same ID. BullMQ stalled-job recovery returns
abandoned active work to that same queue; MySQL leases/generations still fence
old owners. A missing or malformed source response never completes a scan.

Retry state stores only current-page stage attempt counts (bounded by batch size
plus fixed orchestration stages), with no game payloads or per-page history.
Recovery fetches cannot erase an unfinished game's budget. Successful stages
clear their entries; committed checkpoints and resume clear the ledger.

Startup and each 60-second tick reconcile eligibility. Seven days is the default
completion cooldown; set `IGDB_CATALOG_INTERVAL_DAYS=14` on each replica for
fourteen days.

## Internal-only deployment

1. Stop the external Python producer before deploying this application. The old
   `/v1/sync/igdb` endpoint and per-game worker have been removed.
2. Apply the run-state migration and deploy all application replicas. Eligible
   internal synchronization starts automatically; there is no legacy queue drain
   check or fallback mode. The first scan starts at zero and forces relationship
   reconciliation.
3. No manual step is needed: invalid games are skipped and paused runs resume
   automatically. `status` is available for inspection. Interrupted
   running work recovers from the previous durable cursor, replaying a page if
   games committed before its checkpoint. Source-absent local games are retained.
4. There is no producer fallback. Application rollback requires reverting the
   application release; restoring the former external producer is a separate
   operational decision.

Shutdown hooks stop scheduler admission, abort source requests, settle admitted
work and release ownership, then allow queue/database connections to close.
An unexpected kill relies on lease expiry and BullMQ stalled recovery instead.
This repository does not manage or stop the sibling Python deployment. Operators
must stop that service before deploying this internal-only path.

## Redis and logs

Use persistent queue Redis with AOF and `noeviction`, separated from evictable
application caches. The dedicated Compose harness exercises these settings.
Keep bounded log retention in the deployment's log collector/rotation settings;
no deployment Compose edits are required by this change. Run/batch/error logs
contain identifiers, committed counts, cursor, durations and sampled RSS/heap.
Relationship chatter requires `IGDB_SYNC_PROFILE_HOT_PATH=true`; credentials
and complete game payloads are excluded from operational summaries.

## Resource and recovery checks

For the internal-only follow-up, `corepack yarn build`, direct ESLint on changed
TypeScript files without `--fix`, strict OpenSpec validation, and
`git diff --check` passed. The unit, integration, and resource suites have not
yet been rerun against the follow-up; task 10.5 remains open. The ignored reports
above are from the initial implementation.

Run the suites sequentially against the dedicated services. The resource command
starts and awaits fresh Node child processes for 100 pages (2,500 games) and 1,000
pages (25,000 games), at batch size 25 and seed 42. Source IDs are
`seed % 997 + 3 * (index + 1)`, so gaps and expected counts are derived without
keeping the catalog or request history in memory. Each game has a unique cover,
a shared genre and a forward DLC reference; the final reference is above the
scan boundary. Query-aware source responses are generated one page at a time.

```sh
corepack yarn test:igdb:services:up
corepack yarn test:igdb:unit
corepack yarn test:igdb:integration
corepack yarn test:igdb:resources
cat .tmp/igdb-sync/resources-100.json
cat .tmp/igdb-sync/resources-1000.json
corepack yarn test:igdb:services:down
```

The resource run resets only the guarded `igdb_sync_test` import tables. Its
loopback HTTP stub uses fixture authentication; it never requests live IGDB or
Twitch credentials. Keep ordinary integration and resource commands sequential
because they share these test-owned tables. Two-process recovery cases use
unique table/queue prefixes, terminate their own child workers, and remove only
those prefixed tables/queues.

The checker asserts one live page, configured game/relationship bounds,
identifier-only queue data, at most one unresolved run job, and final
cursor/statistics-row counts. A separate 25-run finalization exercise
checks ten completed/ten failed retention, including controlled failure/retry.
Checker-sensitivity cases intentionally introduce eager page fetching and
unbounded relationship work and require rejection.

Reports are ignored artifacts. They record Node version, seed/size, configured
and observed maxima, committed expectations, elapsed time and assertions.
RSS/heap and Redis `used_memory` are sampled every ten pages into fixed-size
warm-up/peak aggregates. These values diagnose local behavior; there is no
machine-dependent memory threshold and no production-capacity conclusion.

Missing Docker or unavailable local service ports produce prerequisite errors;
start Docker and run the services-up command before retrying. Neither failures
nor unexecuted suites should be described as passing. The checks need no remote
server, production secrets, or existing deployment changes.
