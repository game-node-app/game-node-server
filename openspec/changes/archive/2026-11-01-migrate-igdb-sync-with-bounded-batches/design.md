# Design

## Context

See `proposal.md` for motivation and scope. The source producer is the sibling `game-node-sync-igdb` repository: `main.py` posts each page and sleeps 16 seconds, while `igdb/sync/service.py` requests 500 expanded entries with an unordered offset and stores a 30-minute Redis cursor. Its main loop immediately starts another scan when one ends.

The receiving controller returns after `IgdbSyncService.registerUpdateJob` adds normalized per-game payloads to BullMQ. `IgdbSyncProcessor` defaults to eight concurrent games per replica. The game create service already uses checksum checks, query-based relationship loading, and a deterministic weekly reconciliation bucket, but launches direct relationship handlers with `Promise.all`. It logs invalid entries without returning, writes the base checksum before relationships complete, and dispatches statistics initialization without awaiting it. Those behaviors matter for recovery and backpressure.

Nest scheduling, HTTP, TypeORM/MySQL, BullMQ, and Twitch authentication are already present. Production Compose declares two API replicas, two MySQL services, separate cache and queue Redis instances, and a 20-GB queue Redis ceiling with `allkeys-lru`. The discussed 4-vCPU/8-GB machine is only a future sizing reference; no such server is available. All implementation acceptance is local and uses generated data, a stub source, and disposable MySQL/Redis services.

## Goals / Non-Goals

**Goals:** Keep queued payload size independent of catalog size; bound live processing and database fan-out; establish durable recovery and mutually exclusive ingestion modes; preserve supported metadata and relationship reconciliation; make processing bounds locally verifiable.

**Non-Goals:** Incremental-only synchronization, IGDB webhooks, upstream deletion propagation, an importer UI, a separate worker deployment, unrelated statistics/queue rewrites, or a guaranteed throughput figure before measurement. Server provisioning, remote access, production deployment, production capacity measurements, API SLO approval, and edits to existing deployment Compose files are outside this change. No task depends on acquiring infrastructure later.

## Decisions

### 1. One compact run job, processing one page at a time

Add a dedicated catalog orchestration queue, distinct from the legacy per-game queue. Its job contains a run identifier only. An asynchronous worker owns a run and loops through fetch, normalize, persist, and checkpoint; no page successor is created ahead of completion. Queue global concurrency is one, backed by database ownership rather than relying on concurrency alone.

Default page size is 25 (validated 1-500), game concurrency is one (validated 1-2), and relationship concurrency is two (validated 1-2). Enforce the relationship limit across all games in the active run, not separately per game; acquire slots at leaf database operations to avoid nested limiter deadlocks. HTTP responses have a timeout and configurable response-size ceiling; oversized pages fail explicitly rather than exhausting memory. Release page references after checkpointing. Normalize individual games as consumed and remove recursive whole-subtree cloning where equivalent conversion can be maintained.

The worker is I/O-driven and must continue yielding so BullMQ can renew locks. Preserve only a small, fixed count of completed/failed orchestration records (for example, 10 each); durable status lives in MySQL. Duplicate triggers reuse one unresolved job identifier per run. Before enqueueing recovery, reconcile that identifier with durable state and queue state; do not create a fresh failed job on each scheduler tick.

Alternatives: Keeping per-game jobs would require durable batch membership and completion accounting and would retain expanded payloads in Redis. One huge job containing the whole catalog defeats bounded memory. An untracked in-process loop would make restart recovery and scheduling harder. One job per page introduces an unnecessary checkpoint/enqueue handoff to recover.

### 2. MySQL owns durable progress and fenced ownership

Add a singleton catalog sync state entity and migration. Store run ID, state (`idle`, `running`, `paused`, `completed`), last committed game ID, scan upper game ID, run start/completion times, next eligible run time, committed counts, current retry information, last failure summary, and an owner token/generation with lease expiry. Avoid per-page or per-game history growing without retention. State has no TTL and is not stored in the evictable application cache.

An atomic row-lock transaction starts or claims a run. Renew leases conditionally using the owner token and database time. Every game persistence transaction must validate current ownership while locking the state row, and every checkpoint or state change must conditionally match that ownership generation. A takeover waits for any in-flight game transaction; an expired owner that later resumes cannot begin another game or checkpoint. Stop scheduling work on renewal loss, cancel fetches where possible, and await already-started operations before releasing ownership. Pausing or disabling the importer follows the same shutdown discipline.

Startup and a lightweight periodic reconciliation tick resume an interrupted `running` run when ownership has expired and its queue job needs recovery. Duplicate or stale jobs exit on run/owner mismatch. A paused run is never automatically restarted by a timer. A small operator CLI reports durable status and explicitly resumes paused work; it uses the same claim/enqueue path and does not require a new public HTTP endpoint.

Alternative: A process-local flag is insufficient with replicas. Redis-only locks/cursors add dependence on queue persistence and eviction, and a lock without fencing permits stale workers to advance progress.

### 3. Ordered full scans with a finite upper boundary

At the beginning of a new run, fetch the largest existing IGDB game ID using a minimal query and persist it as that run's upper boundary before processing. Request supported fields with explicit `sort id asc` and `where id > committedId & id <= upperId`, limited to the configured page size. Advance the cursor to the largest successfully processed ID only after the complete page succeeds. A valid empty page completes the run; a short nonempty page is still committed and followed by an empty-page check.

The boundary makes a scan finite while new games are added. It does not create a remote snapshot: changes to already-traversed entries and newly created games are picked up by a later full scan. Preserve all currently consumed metadata by auditing the Python field list against entity/conversion mappings before replacing wildcard expansions with explicit fields. Preserve explicit deprecated fields where current mappings still require them. Do not convert the Python offset into an ID cursor; the internal importer starts every new full scan from the beginning.

Alternative: Offset pagination over a changing catalog can shift page boundaries. Incremental filtering by game `updated_at` alone has not been shown to capture all changes in expanded relationships and is deferred.

### 4. Game writes and statistics complete together

Refactor the import persistence path to accept a transaction-scoped entity manager. Validate before writes and throw a classified error for invalid entries. Base row updates, required relation writes, and create-if-missing game statistics initialization participate in the same per-game transaction. No relationship handler may escape to an injected repository outside that transaction. Commit the base checksum together with the relationships, so a failure rolls both back. Normal unchanged-game checksum optimization and existing reconciliation buckets remain in place.

The catalog importer always ensures statistics exist on replay as well as first creation; insert-if-absent must preserve counters and handle a uniqueness race safely. Catalog statistics are created in the game transaction and never dispatched through the legacy fire-and-forget statistics queue. Other statistics producers keep their existing behavior. An interrupted batch can replay committed games safely, with no duplicate associations or reset counters. Explicitly settle all started tasks before retrying a failed page; `Promise.all` rejecting early must not leave writes racing with a retry.

Game-to-game links can reference IDs on later pages or above the current scan boundary. Before inserting these links, use the current game's transaction manager and relationship limiter to insert minimal referenced-game rows (ID, source-provided name and slug) if absent. Validate reference identity/name/slug, use insert-if-missing semantics, and never overwrite an existing game's metadata or checksum. Leave a new reference row's checksum null so a later full import cannot mistake it for completed ingestion. Initialize statistics for newly referenced games through the same insert-if-missing transaction path, preserving existing counters and submitting no queue jobs. Reference rows, statistics and junction links roll back with the current game. Reference-only inserts do not increment committed game/batch counts or advance the scan cursor; IDs above the upper boundary remain eligible for full hydration in a later scan. Do not fetch ahead, recursively import references, or retain a deferred-link backlog. Every catalog import must use this transaction-scoped context; there is no legacy per-game import path.

The page checkpoint is separate from per-game transactions. A crash after game commit but before checkpoint causes bounded replay, not skipped work. Existing partial relationship writes from the old importer require a one-time forced reconciliation pass on the first catalog run; persist this flag with the run so normal checksum skipping cannot hide legacy damage.

Alternative: A durable dirty marker could repair partial writes, but per-game transactions provide a clearer completion boundary and avoid another cleanup mechanism. One transaction for a whole page would retain locks longer and increase rollback work.

### 5. Scheduling, failure handling, and source requests

Internal sync is always active; there is no enable/disable feature flag. The scheduler runs on application startup and every 60 seconds, and creates or recovers a run whenever durable state is eligible. Refresh interval defaults to seven days and accepts fourteen days. A new installation with no run is immediately eligible. Completion sets `nextEligibleAt = completedAt + interval`; thus the interval is a cooldown after a successful scan, not a promise of completion on an exact weekday. A slow run is resumed rather than overlapped. Store timestamps in UTC. Repeated scheduler ticks create neither duplicate work nor catch-up runs.

Reuse `IgdbAuthService`. Fetch requests validate status and array shape; malformed bodies never count as end-of-catalog. Allow three attempts per failing stage with exponential backoff and jitter, honor an available retry delay for 429 responses, and bound all waits. Refresh authentication once on an expired-token response before classifying a persistent authentication failure. Route catalog requests through a limiter that respects the IGDB credential-wide budget, including the existing time-to-beat caller. Persist retry accounting sufficiently to avoid resetting an exhausted budget during recovery. Database deadlocks/timeouts retry through the same safe transaction boundary. Exhaustion or deterministic data errors pause the run with its checkpoint unchanged.

References checked during exploration: [IGDB API documentation](https://api-docs.igdb.com/) specifies a maximum page limit of 500, four requests per second, and eight open requests. These limits constrain outbound requests, separately from local persistence concurrency.

### 6. Single-project ingestion and operational configuration

Remove the legacy authenticated payload endpoint, per-game queue registration/worker, and legacy-queue drain/acknowledgment gate. The application exposes only the in-process catalog importer; former producer requests are not accepted or queued. The outbound IGDB request budget uses its own Redis-backed queue namespace. Stop the external producer before deployment as an operational ordering requirement; application code does not inspect or wait for the former queue.

Document queue Redis persistence and `noeviction`, keeping cache eviction separate. Exercise these settings in `test/igdb/docker-compose.yml`, not the existing development or production deployment files. This disposable harness runs only MySQL 8 and Redis 7, binds to loopback with configurable non-default ports, has its own Compose project/volumes, and does not connect to the developer's existing database or queues. It requires no authentication service, frontend, external producer, or production secrets.

Emit structured run/batch summaries, committed counters, cursor, batch timing, retry/pause reasons, and sampled process RSS/heap. Move repetitive relation-level logs behind profiling/debug configuration. Keep observability changes within the import path.

### 7. Local verification contract and implementation defaults

Use files under `src/sync/igdb/catalog/` for the single importer. Tests in that directory use the existing unit Jest configuration. Put local integration tests and their explicit Jest configuration under `test/igdb/` so they do not get silently excluded by the current `rootDir: src`. Import only the importer, required game/statistics entities, and infrastructure providers in the test module; do not bootstrap `AppModule` and its authentication/external integrations.

The implementation checklist names proposed files and interfaces as a concrete starting point. Reuse an existing equivalent if it can meet the same contract without increasing scope, and update the task reference when doing so. New configuration lives in `catalog/igdb-catalog.config.ts` with these explicit defaults:

- Internal synchronization starts automatically; no activation flag exists. The interval is `IGDB_CATALOG_INTERVAL_DAYS=7`, accepting only 7 or 14.
- `IGDB_CATALOG_BATCH_SIZE=25` (1-500), `IGDB_CATALOG_GAME_CONCURRENCY=1` (1-2), `IGDB_CATALOG_RELATION_CONCURRENCY=2` (1-2).
- `IGDB_CATALOG_HTTP_TIMEOUT_MS=30000` (1000-60000), `IGDB_CATALOG_MAX_RESPONSE_BYTES=16777216` (1048576-67108864), and `IGDB_CATALOG_MAX_ATTEMPTS=3` (1-5).
- Fixed lease duration 120 seconds, renewal every 20 seconds, scheduler reconciliation every 60 seconds. All use injectable time sources in tests; do not wait minutes or weeks in the suite. Bound database statements/transactions to less than the lease duration; a game transaction must release its state-row lock before another owner or renewal can proceed.
- Retry delay starts at 1000 ms, doubles between attempts, adds 0-250 ms jitter, and caps at 30000 ms. Cap `Retry-After` waits at 30000 ms as well. Explicit resume clears the failing-stage attempt budget, preserving cursor, run ID, and upper boundary.
- Retain at most 10 completed and 10 failed orchestration jobs. Use `igdb-catalog-<runId>` as the one unresolved job ID; do not use colons in BullMQ job IDs. Durable state, not BullMQ auto-retry history, owns stage retry accounting.

Provide `yarn test:igdb:unit`, `yarn test:igdb:integration`, and `yarn test:igdb:resources` entry points. Integration/resource commands use the dedicated local Compose project and test database. Refuse non-loopback database/Redis hosts, use fixture authentication, and restrict deletion to the test database and namespaced test queues. These commands must never fall back to application `.env` credentials. Provide start/cleanup commands and a clear prerequisite error when Docker is unavailable; missing Docker is not permission to request a server or mark an unexecuted test passed.

The resource runner generates catalog entries lazily for 100-page and 1000-page runs at batch size 25. It does not keep the generated catalog, request history, timing samples, or processed IDs in a growing in-memory array. Each run uses a fresh child process, identical fixture shape, and optional `--expose-gc` only for diagnostic heap samples. Generate nested relationships with a seeded, documented fixture; derive expected counts from seed and cursor rather than storing every ID.

Required pass/fail assertions are structural: maximum live pages equals one, maximum active games/relationship operations does not exceed configuration, orchestration payloads contain only the run identifier, at most one unresolved orchestration job exists, retained terminal jobs stay within the configured counts after finalization, and the committed cursor/count and transactional statistics rows equal fixture expectations. Include a separate 25-run retention test so retention is exercised rather than inferred from a single run.

Write the resource report to an ignored temporary/output directory, recording fixture size, batch size, configured/observed bounds, warm-up and peak RSS/heap, Redis `used_memory`, elapsed time, and Node.js version. Report memory samples every ten pages using bounded aggregates. Garbage collection, native allocators, and host load vary; RSS/heap trends are diagnostic and must not be used as a flaky cross-machine memory-threshold assertion. These results establish local boundedness only, with no API latency, disk capacity, production scan-duration, or rented-server acceptance gate.

Alternative: Raising Redis memory alone does not address an unbounded producer. Automatically increasing concurrency or silently switching to fortnightly imports would obscure capacity limits; tuning remains an explicit operator decision.

## Risks / Trade-offs

- Full scans cost more requests than incremental imports -> preserve cheap checksum checks, avoid fetching unused fields, and measure elapsed time before considering incremental work.
- Transactions and ownership row locks serialize writes -> this matches the conservative one-game default; benchmark before increasing concurrency.
- Related-entity cycles or concurrent writes elsewhere may cause deadlocks -> preserve dependency ordering, use bounded retries, and test real MySQL behavior.
- Large individual game graphs can still exceed a page's expected cost -> enforce response limits, record the failing stage, and pause rather than silently discard metadata.
- Local fixture measurements do not establish future production capacity -> report environment and fixture parameters and limit acceptance to the stated processing/queue bounds.
- A crash can repeat a page -> transactional/idempotent persistence and insert-if-missing statistics make that safe.
- A weekly scan with existing four-bucket reconciliation does not reconcile every unchanged relation weekly -> preserve existing semantics and force a complete relation pass at cutover; tightening the ongoing relation freshness policy is separate work.

## Migration Plan

The external producer is no longer part of the supported application. Stop it before deploying the internal-only application. The state migration remains required; once it is applied, startup automatically schedules the first eligible full scan. Validate automatic startup and recovery in the local harness.

1. Stop the external producer before rolling out this application. Complete the deployment before allowing the new workers to start, so no old application replica continues consuming legacy per-game jobs.
2. Apply the run-state migration. Internal sync starts automatically on startup and begins the first eligible scan from ID zero.
3. Use `yarn igdb:catalog status` to inspect the run; correct persistent failures and use `yarn igdb:catalog resume` after correction.
4. Keep the default seven-day interval or set `IGDB_CATALOG_INTERVAL_DAYS=14` on every replica.
5. There is no producer fallback mode. Application rollback requires reverting the application release; restoring the former external producer is a separate operational decision.
